pragma ton-solidity >=0.54.0;
pragma AbiHeader time;
pragma AbiHeader expire;
pragma AbiHeader pubkey;

import "./modifiers/modifiers.sol";

import "./Libraries/SMVErrors.sol";
import "./External/tip3/interfaces/ITokenRoot.sol";

import "./Interfaces/ISMVClient.sol";
import "./Interfaces/ISMVProposal.sol";
import "./Interfaces/IVotingResultRecipient.sol";
import "./Interfaces/Igoshdao.sol";

import "./LockableBase.sol";

abstract contract SMVProposalBase is Modifiers, LockableBase, ISMVProposal  {

uint256 public propId;
uint32  creationTime;
address public tokenRoot;

TvmCell public propData;
mapping (address => bool) public reviewers;
uint32 public startTime;
uint32 public finishTime;
uint32 public deltaStartTime;
uint32 public deltaFinishTime;
address public ownerAddress;

uint128 public votesYes;
uint128 public votesNo;
optional (bool) public votingResult;
uint128 public amountLocked;
uint128 public totalSupply;
//bool public proposalBusy;
//uint128 total_votes;
uint32 public realFinishTime;

function amount_locked () public override view returns(uint128)
{
    return amountLocked;
}

function calcExternalClientAddress (address /* _tokenLocker */, uint256 _platform_id) internal view returns(uint256)
{
    TvmCell dataCell = tvm.buildDataInit ( {contr:LockerPlatform,
                                            varInit:{
                                                /* tokenLocker: _tokenLocker, */
                                                platform_id: _platform_id } } );
    uint256 dataHash = tvm.hash (dataCell);
    uint16 dataDepth = dataCell.depth();

    uint256 add_std_address = tvm.stateInitHash (platformCodeHash, dataHash , platformCodeDepth, dataDepth);
    return add_std_address ;
}

modifier check_external_client (address _tokenLocker, uint256 _platform_id) {
    uint256 expected = calcExternalClientAddress (_tokenLocker, _platform_id);
    require ( msg.sender.value == expected, SMVErrors.error_not_my_external_client) ;
    _ ;
}

modifier check_token_root {
    require ( msg.sender == tokenRoot, SMVErrors.error_not_my_token_root) ;
    _ ;
}

function acceptReviewer() external override
{
    require(msg.value > 0, SMVErrors.error_not_internal_message);
    require(reviewers.exists(msg.sender), SMVErrors.error_not_my_reviewer);

    delete reviewers[msg.sender];

    if (reviewers.empty())
    {
        startTime = block.timestamp + deltaStartTime;
        finishTime = block.timestamp + deltaStartTime + deltaFinishTime;
        realFinishTime = finishTime;
    }

    address(msg.sender).transfer(0, false, 64);
} 

function rejectReviewer() external override
{
    require(msg.value > 0, SMVErrors.error_not_internal_message);
    require(reviewers.exists(msg.sender), SMVErrors.error_not_my_reviewer);

    delete reviewers;
    reviewers[msg.sender] = true;
    votingResult.set(false) ;
    realFinishTime = block.timestamp;
    IVotingResultRecipient(ownerAddress).isCompletedCallback {value:SMVConstants.EPSILON_FEE, flag: 1} (platform_id, votingResult, propData);
    address(msg.sender).transfer(0, false, 64);
} 

function onCodeUpgrade (address goshdao,
                		uint256 _platform_id,
                        uint128 amountToLock,
                        uint128 /* totalVotes */,
                        TvmCell staticCell,
                        TvmCell inputCell) internal override
{
    tvm.resetStorage();

    _goshdao = goshdao;
    initialized = true;
    votingResult.reset();
    leftBro.reset();
    rightBro.reset();
    rightAmount.reset();
    currentHead.reset();
    platform_id = _platform_id;
    amountLocked = amountToLock;
    //proposalBusy = false;
    //total_votes = totalVotes;

    ( , tokenLocker , propId, platformCodeHash, platformCodeDepth) = staticCell.toSlice().decode(uint8, address, uint256, uint256, uint16);

    TvmSlice s = inputCell.toSlice();
    TvmSlice s1 = s.loadRefAsSlice(); //inputCell+currentHead

    TvmSlice propDataExtra = s1.loadRefAsSlice();
    propData = propDataExtra.loadRef();
    TvmSlice reviewersSlice = propDataExtra.loadRefAsSlice();
    reviewers = reviewersSlice.decode(mapping (address => bool));


    TvmSlice s12 = s1.loadRefAsSlice();
    (deltaStartTime, deltaFinishTime, ownerAddress, tokenRoot) = s12.decode(uint32, uint32, address, address);
    if (reviewers.empty())
    {
        startTime = block.timestamp + deltaStartTime;
        finishTime = block.timestamp + deltaStartTime + deltaFinishTime;
    }
    else
    {
        startTime = 0xFFFFFFFF;
        finishTime = 0;
    }
    realFinishTime = finishTime;
    currentHead = s.decode(optional(address));

    uint128 extra = 0;
    if (address(this).balance > SMVConstants.PROPOSAL_INIT_VALUE)
        {extra = address(this).balance - SMVConstants.PROPOSAL_INIT_VALUE;}

    if (extra == 0)
    {
        optional (address) emptyAddress;
        optional (uint128) emptyValue;
        ISMVTokenLocker(tokenLocker).onClientCompleted {value:0, flag:128+32} (platform_id, false, emptyAddress, emptyValue, true);
    }
    else
    {
        //ISMVTokenLocker(tokenLocker).onInitialized {value: SMVConstants.EPSILON_FEE, flag: 1} (platform_id);
        delete_and_do_action();
    }
}

function onContinueAction(uint128 t) external senderIs(_goshdao) accept
{
    totalSupply = t;

    leftBro.reset();
    rightBro.reset();
    rightAmount.reset();

    if ((currentHead.hasValue()) && (currentHead.get()!=address(this))) {
        uint128 extra = _reserve (SMVConstants.PROPOSAL_MIN_BALANCE, SMVConstants.ACTION_FEE);
        LockableBase(currentHead.get()).insertClient {value:extra, flag:1} (platform_id, address(this), amount_locked());
    }
    else
    {
        //currentHead.set(address(this));
        uint128 extra = _reserve (SMVConstants.PROPOSAL_MIN_BALANCE, SMVConstants.ACTION_FEE);
        ISMVTokenLocker(tokenLocker).onClientCompleted {value: extra, flag:1} (platform_id, true, address(this), amount_locked(), false);
    }
}

function do_action() internal override
{
    IGoshDao(_goshdao).asktotalSupply {value: 0.25 ton, flag: 1} ();
}

//this prevents hang when creating the same proposal
function performAction (uint128 /* amountToLock */, uint128 /* total_votes */, TvmCell /* inputCell */, address goshdao) external override check_locker
{
    _goshdao = goshdao;
    optional (address) emptyAddress;
    optional (uint128) emptyValue;
    uint128 extra = _reserve (SMVConstants.PROPOSAL_MIN_BALANCE , SMVConstants.ACTION_FEE);
    ISMVTokenLocker(tokenLocker).onClientCompleted {value:extra, flag:1} (platform_id, false, emptyAddress, emptyValue, false);
}

function getInitialize(address _tokenLocker, uint256 _platform_id) external override check_external_client(_tokenLocker, _platform_id)
{
    require(msg.value >= SMVConstants.PROP_INITIALIZE_FEE, SMVErrors.error_balance_too_low);
    //require(!proposalBusy, SMVErrors.proposal_is_busy);
    tvm.accept();

    bool allowed = //(!proposalBusy) &&
                   reviewers.empty() &&
                   (block.timestamp >= startTime) &&  (block.timestamp < finishTime) && (!votingResult.hasValue());

    if (!allowed)
        ISMVClient(msg.sender).initialize {value:0, flag: 64} (false, finishTime);
    else {
        tryEarlyComplete(totalSupply);
        /* bool  */allowed = !votingResult.hasValue();
        if (!allowed)
        {
            IVotingResultRecipient(ownerAddress).isCompletedCallback {value:SMVConstants.EPSILON_FEE, flag: 1} (platform_id, votingResult, propData);
        }
        ISMVClient(msg.sender).initialize {value:0, flag: 64} (allowed, finishTime);
    }
}

function vote (address _locker, uint256 _platform_id, bool choice, uint128 amount) external override check_external_client(_locker,_platform_id)
{
    require(msg.value >= SMVConstants.PROPOSAL_VOTING_FEE, SMVErrors.error_balance_too_low);
    
    tvm.accept();

    if (/* (proposalBusy) || */ (block.timestamp < startTime) || (block.timestamp >= finishTime) || (votingResult.hasValue()) )
        //return {value:0, flag: 64} false;
        ISMVClient(msg.sender).onProposalVoted {value:0, flag: 64} (false);
    else {
//        tryEarlyComplete(totalSupply);

        if (votingResult.hasValue())
            ISMVClient(msg.sender).onProposalVoted {value:0, flag: 64} (false);
        else
        {
            if (choice)
                votesYes += amount;
            else
                votesNo += amount;
            tryEarlyComplete(totalSupply);
            if (votingResult.hasValue())
            {
                IVotingResultRecipient(ownerAddress).isCompletedCallback {value:SMVConstants.EPSILON_FEE, flag: 1} (platform_id, votingResult, propData);
            }
            ISMVClient(msg.sender).onProposalVoted {value:0, flag: 64} (true);
        }
    }
}

function completeVoting() internal
{
    if ((address(this).balance > SMVConstants.PROPOSAL_MIN_BALANCE + SMVConstants.VOTING_COMPLETION_FEE) &&
        (block.timestamp >= startTime) &&
        (!votingResult.hasValue())/* || (proposalBusy) */)
    {
        if (block.timestamp < finishTime)
            tryEarlyComplete(totalSupply);
        else
            calcVotingResult(totalSupply);
    }
}

function isCompleted () override public
{
    require (msg.value > SMVConstants.EPSILON_FEE, SMVErrors.error_balance_too_low);

    completeVoting();
    IVotingResultRecipient(msg.sender).isCompletedCallback {value:0, flag: 64} (platform_id, votingResult, propData);
}

function _isCompleted () public view returns (optional (bool))
{
    return votingResult;
}





//gosh only
//b.store(proposalKind, repoName, branchName, commitName, fullCommit, parent1, parent2);
function getGoshProposalKind() external view returns( uint256  proposalKind)
{
    TvmSlice s = propData.toSlice();
    (proposalKind) = s.decode(uint256);
}

function getGoshSetCommitProposalParams () external view
         returns( uint256  proposalKind,  string repoName, string  branchName,  string commit, optional(ConfigCommit) task, string comment)
{
    (proposalKind,  repoName,  branchName,  commit,,, task, comment,) = abi.decode(propData, (uint256, string, string, string, uint128, uint128, optional(ConfigCommit), string, uint32));
}

function getGoshAddProtectedBranchProposalParams () external view
         returns( uint256  proposalKind,  string repoName, string  branchName, string comment)
{
    (proposalKind,  repoName,  branchName, comment,) = abi.decode(propData, (uint256, string, string, string, uint32));
}

function getGoshSetConfigDaoProposalParams () external view
         returns( uint256  proposalKind,  uint128 token, string comment)
{
    (proposalKind, token, comment, ) = abi.decode(propData, (uint256, uint128, string, uint32));
}

function getGoshDeleteProtectedBranchProposalParams () external view
         returns( uint256  proposalKind,  string repoName, string  branchName, string comment)
{
    (proposalKind,  repoName,  branchName, comment,) = abi.decode(propData, (uint256, string, string, string, uint32));
}

function getGoshDeployWalletDaoProposalParams () external view
         returns( uint256  proposalKind, MemberToken[] pubaddr, optional(string)[] dao, string comment)
{
    (proposalKind, pubaddr, dao, comment,) = abi.decode(propData, (uint256, MemberToken[], optional(string)[], string, uint32));
}

function getGoshDeleteWalletDaoProposalParams () external view
         returns( uint256  proposalKind, address[] pubaddr, string comment)
{
    (proposalKind, pubaddr, comment, ) = abi.decode(propData, (uint256, address[], string, uint32));
}

function getGoshUpgradeDaoProposalParams () external view
         returns( uint256  proposalKind, string newversion, string description, string comment)
{
    (proposalKind, newversion, description, comment, ) = abi.decode(propData, (uint256, string, string, string, uint32));
}

function getGoshConfirmTaskProposalParams () external view
         returns( uint256  proposalKind, string reponame, string taskname, uint128 index, string comment)
{
    (proposalKind, reponame, taskname, index, comment, ) = abi.decode(propData, (uint256, string, string, uint128, string, uint32));
}

function getGoshDestroyTaskProposalParams () external view
         returns( uint256  proposalKind, string reponame, string taskname, string comment)
{
    (proposalKind, reponame, taskname, comment, ) = abi.decode(propData, (uint256, string, string, string, uint32));
}

function getGoshDestroyBigTaskProposalParams () external view
         returns( uint256  proposalKind, string reponame, string taskname, string comment)
{
    (proposalKind, reponame, taskname, comment, ) = abi.decode(propData, (uint256, string, string, string, uint32));
}

function getGoshDeployTaskProposalParams () external view
         returns( uint256  proposalKind, string reponame, string taskname, string[] tag, ConfigGrant grant, optional(ConfigCommitBase) workers, string comment)
{
    (proposalKind, reponame, taskname, tag, grant, workers, comment,) = abi.decode(propData, (uint256, string, string, string[], ConfigGrant, optional(ConfigCommitBase), string, uint32));
}

function getGoshDeployRepoProposalParams () external view
         returns(uint256  proposalKind,  string repoName, string descr, optional(AddrVersion) previous, string comment)
{
    (proposalKind, repoName, descr, previous, comment,) = abi.decode(propData, (uint256, string, string, optional(AddrVersion), string, uint32));
}

function getGoshAddVoteTokenProposalParams () external view
         returns(uint256  proposalKind,  address pubaddr, uint128 grant, string comment)
{
    (proposalKind, pubaddr, grant, comment, ) = abi.decode(propData, (uint256, address, uint128, string, uint32));
}

function getGoshAddRegularTokenProposalParams () external view
         returns(uint256  proposalKind,  address pubaddr, uint128 grant, string comment)
{
    (proposalKind, pubaddr, grant, comment, ) = abi.decode(propData, (uint256, address, uint128, string, uint32));
}

function getGoshMintTokenProposalParams () external view
         returns(uint256  proposalKind,  uint128 grant, string comment)
{
    (proposalKind, grant, comment, ) = abi.decode(propData, (uint256, uint128, string, uint32));
}

function getGoshDaoTagProposalParams () external view
         returns(uint256  proposalKind,  string[] daotag, string comment)
{
    (proposalKind, daotag, comment, ) = abi.decode(propData, (uint256, string[], string, uint32));
}

function getDaoAskGrantProposalParams () external view
         returns( uint256  proposalKind, address wallet, string reponame, string taskname, string comment)
{
    (proposalKind, wallet, reponame, taskname, comment, ) = abi.decode(propData, (uint256, address, string, string, string, uint32));
}

function getNotAllowMintProposalParams () external view
         returns(uint256  proposalKind, string comment)
{
    (proposalKind, comment, ) = abi.decode(propData, (uint256, string, uint32));
}

function getChangeAllowanceProposalParams () external view
         returns(uint256  proposalKind, address[] pubaddr, bool[] increase, uint128[] grant, string comment)
{
    (proposalKind, pubaddr, increase, grant, comment, ) = abi.decode(propData, (uint256, address[], bool[], uint128[], string, uint32));
}

function getAbilityInviteProposalParams () external view
         returns(uint256  proposalKind, bool result)
{
         (proposalKind, result, ,) = abi.decode(propData,(uint256, bool, string, uint32));  
}

function getSendReviewProposalParams () external view
         returns(uint256  proposalKind, address wallet, address propAddr, bool result, string comment)
{
         (proposalKind, wallet, propAddr, result, comment,) = abi.decode(propData,(uint256, address, address, bool, string, uint32));  
}

function getGoshRepoTagProposalParams () external view
         returns(uint256  proposalKind,  string[] daotag, string repo, string comment)
{
    (proposalKind, daotag, repo, comment, ) = abi.decode(propData, (uint256, string[], string, string, uint32));
}

function getChangeDescriptionProposalParams () external view
         returns(uint256  proposalKind,  string repo, string descr, string comment)
{
    (proposalKind, repo, descr, comment, ) = abi.decode(propData, (uint256, string, string, string, uint32));
}

function getUpgradeCodeProposalParams () external view
         returns(uint256  proposalKind,  TvmCell UpdateCode, TvmCell cell, string comment)
{
    (proposalKind, UpdateCode, cell, comment, ) = abi.decode(propData, (uint256, TvmCell, TvmCell, string, uint32));
}

function getChangeHideVotingResultProposalParams () external view
         returns(uint256  proposalKind,  bool result, string comment)
{
    (proposalKind, result, comment, ) = abi.decode(propData, (uint256, bool, string, uint32));
}

function getChangeAllowDiscussionProposalParams () external view
         returns(uint256  proposalKind,  bool result, string comment)
{
    (proposalKind, result, comment, ) = abi.decode(propData, (uint256, bool, string, uint32));
}

function getTagUpgradeProposalParams () external view
         returns(uint proposalKind, string[] repoName, string[] nametag, string newversion) 
{
     (proposalKind, repoName, nametag, newversion, ,) = abi.decode(propData, (uint256, string[], string[], string, string, uint32));
}

function getDaoSendTokenProposalParams () external view
         returns(uint256 proposalKind, address wallet, optional(address) pubaddr, uint128 grant)
{
    (proposalKind, wallet, pubaddr, grant,,) = abi.decode(propData, (uint256, address, optional(address), uint128, string, uint32));
}

function getUpgradeTaskProposalParams () external view
         returns( uint256  proposalKind, string taskname, string reponame, string oldversion, address oldtask, string[] hashtag, string comment)
{
    (proposalKind, taskname, reponame, oldversion, oldtask, hashtag, comment,) = abi.decode(propData, (uint256, string, string, string, address, string[], string, uint32));
}

function getStartMembershipProposalParams () external view
         returns(uint proposalKind, PaidMember newProgram, uint8 Programindex) 
{

     (proposalKind, newProgram, Programindex,,) = abi.decode(propData, (uint256, PaidMember, uint8, string, uint32));
}

function getStartMembershipProposalParamsData (TvmCell Data) external pure
         returns(uint proposalKind, PaidMember newProgram, uint8 Programindex) 
{

     (proposalKind, newProgram, Programindex,,) = abi.decode(Data, (uint256, PaidMember, uint8, string, uint32));
}

function getBigTaskUpgradeProposalParams () external view
         returns(uint proposalKind, string taskname, string reponame, string oldversion, address oldtask, string[] hashtag) 
{
    (proposalKind, taskname, reponame, oldversion, oldtask, hashtag,,) = abi.decode(propData, (uint256, string, string, string, address, string[], string, uint32));
}

function getBigTaskUpgradeProposalParamsData (TvmCell Data) external pure
         returns(uint proposalKind, string taskname, string reponame, string oldversion, address oldtask, string[] hashtag) 
{
    (proposalKind, taskname, reponame, oldversion, oldtask, hashtag,,) = abi.decode(Data, (uint256, string, string, string, address, string[], string, uint32));
}

function getBigTaskProposalParams () external view
         returns(uint proposalKind, string taskname, string repoName) 
{
        (proposalKind, taskname, repoName,) = abi.decode(propData,(uint256, string, string, uint32));
}

function getBigTaskParamsData (TvmCell Data) external pure
         returns(uint proposalKind, string taskname, string repoName) 
{
        (proposalKind, taskname, repoName,) = abi.decode(Data,(uint256, string, string, uint32));
}

function getBigTaskDeployProposalParams () external view
         returns(uint proposalKind, string repoName, string taskName, string[] tag, ConfigGrant grant, ConfigCommit commit, uint128 freebalance) 
{
        (proposalKind, repoName, taskName, tag, grant, commit, freebalance, ,) = abi.decode(propData,(uint256, string, string, string[], ConfigGrant, ConfigCommit, uint128, string, uint32));
}

function getBigTaskDeployParamsData (TvmCell Data) external pure
         returns(uint proposalKind, string repoName, string taskName, string[] tag, ConfigGrant grant, ConfigCommit commit, uint128 freebalance) 
{
        (proposalKind, repoName, taskName, tag, grant, commit, freebalance, ,) = abi.decode(Data,(uint256, string, string, string[], ConfigGrant, ConfigCommit, uint128, string, uint32));
}

function getStopMembershipProposalParams () external view
         returns(uint proposalKind, uint8 Programindex) 
{

     (proposalKind, Programindex,,) = abi.decode(propData, (uint256, uint8, string, uint32));
}

function getStopMembershipProposalParamsData (TvmCell Data) external pure
         returns(uint proposalKind, uint8 Programindex) 
{

     (proposalKind, Programindex,,) = abi.decode(Data, (uint256, uint8, string, uint32));
}

function getDaoVoteProposalParams () external view
         returns(uint proposalKind, address wallet, uint256 platform_id, bool choice, uint128 amount, uint128 num_clients_base, string note) 
{

     (proposalKind, wallet, platform_id, choice, amount, num_clients_base, note,,) = abi.decode(propData, (uint256, address, uint256, bool, uint128, uint128, string, string, uint32));
}

function getGoshProposalKindData(TvmCell Data) external pure returns( uint256  proposalKind)
{
    TvmSlice s = Data.toSlice();
    (proposalKind) = s.decode(uint256);
}

function getGoshSetCommitProposalParamsData (TvmCell Data) external pure
         returns( uint256  proposalKind,  string repoName, string  branchName,  string commit, optional(ConfigCommit) task, string comment)
{
    (proposalKind,  repoName,  branchName,  commit,,, task, comment,) = abi.decode(Data, (uint256, string, string, string, uint128, uint128, optional(ConfigCommit), string, uint32));
}

function getGoshAddProtectedBranchProposalParamsData (TvmCell Data) external pure
         returns( uint256  proposalKind,  string repoName, string  branchName, string comment)
{
    (proposalKind,  repoName,  branchName, comment,) = abi.decode(Data, (uint256, string, string, string, uint32));
}

function getGoshSetConfigDaoProposalParamsData (TvmCell Data) external pure
         returns( uint256  proposalKind,  uint128 token, string comment)
{
    (proposalKind, token, comment, ) = abi.decode(Data, (uint256, uint128, string, uint32));
}

function getGoshDeleteProtectedBranchProposalParamsData (TvmCell Data) external pure
         returns( uint256  proposalKind,  string repoName, string  branchName, string comment)
{
    (proposalKind,  repoName,  branchName, comment,) = abi.decode(Data, (uint256, string, string, string, uint32));
}

function getGoshDeployWalletDaoProposalParamsData (TvmCell Data) external pure
         returns( uint256  proposalKind, MemberToken[] pubaddr, optional(string)[] dao, string comment)
{
    (proposalKind, pubaddr, dao, comment,) = abi.decode(Data, (uint256, MemberToken[], optional(string)[], string, uint32));
}

function getGoshDeleteWalletDaoProposalParamsData (TvmCell Data) external pure
         returns( uint256  proposalKind, address[] pubaddr, string comment)
{
    (proposalKind, pubaddr, comment, ) = abi.decode(Data, (uint256, address[], string, uint32));
}

function getGoshUpgradeDaoProposalParamsData (TvmCell Data) external pure
         returns( uint256  proposalKind, string newversion, string description, string comment)
{
    (proposalKind, newversion, description, comment, ) = abi.decode(Data, (uint256, string, string, string, uint32));
}

function getGoshConfirmTaskProposalParamsData (TvmCell Data) external pure
         returns( uint256  proposalKind, string reponame, string taskname, uint128 index, string comment)
{
    (proposalKind, reponame, taskname, index, comment, ) = abi.decode(Data, (uint256, string, string, uint128, string, uint32));
}

function getDaoAskGrantProposalParamsData (TvmCell Data) external pure
         returns( uint256  proposalKind, address wallet, string reponame, string taskname, string comment)
{
    (proposalKind, wallet, reponame, taskname, comment, ) = abi.decode(Data, (uint256, address, string, string, string, uint32));
}

function getDaoMultiProposalParams () external view
         returns( uint256  proposalKind, address wallet, uint128 number, TvmCell proposals, uint128 num_clients_base, address[] reviewers_base)
{
    (proposalKind, wallet, number, proposals, num_clients_base, reviewers_base,) = abi.decode(propData, (uint256, address, uint128, TvmCell, uint128, address[], uint32));
}

function getDaoMultiProposalParamsData (TvmCell Data) external pure
         returns( uint256  proposalKind, address wallet, uint128 number, TvmCell proposals, uint128 num_clients_base, address[] reviewers_base)
{
    (proposalKind, wallet, number, proposals, num_clients_base, reviewers_base,) = abi.decode(Data, (uint256, address, uint128, TvmCell, uint128, address[], uint32));
}

function getDaoTransferTokenProposalParams () external view
         returns( uint256  proposalKind, address wallet, address newwallet, uint128 grant, string oldversion, string comment)
{
    (proposalKind, wallet, newwallet, grant, oldversion, comment,) = abi.decode(propData,(uint256, address, address, uint128, string, string, uint32));
}

function getDaoTransferTokenProposalParamsData (TvmCell Data) external pure
         returns( uint256  proposalKind, address wallet, address newwallet, uint128 grant, string oldversion, string comment)
{
    (proposalKind, wallet, newwallet, grant, oldversion, comment,) = abi.decode(Data,(uint256, address, address, uint128, string, string, uint32));
}

function getDaoLockVoteProposalParams () external view
         returns( uint256  proposalKind, address wallet, bool isLock, uint128 grant, string comment)
{
    (proposalKind, wallet, isLock, grant, comment, ) = abi.decode(propData, (uint256, address, bool, uint128, string, uint32));
}

function getDaoLockVoteProposalParamsData (TvmCell Data) external pure
         returns( uint256  proposalKind, address wallet, bool isLock, uint128 grant, string comment)
{
    (proposalKind, wallet, isLock, grant, comment, ) = abi.decode(Data, (uint256, address, bool, uint128, string, uint32));
}

function getGoshDestroyTaskProposalParamsData (TvmCell Data) external pure
         returns( uint256  proposalKind, string reponame, string taskname, string comment)
{
    (proposalKind, reponame, taskname, comment, ) = abi.decode(Data, (uint256, string, string, string, uint32));
}

function getGoshDestroyBigTaskProposalParamsData (TvmCell Data) external pure
         returns( uint256  proposalKind, string reponame, string taskname, string comment)
{
    (proposalKind, reponame, taskname, comment, ) = abi.decode(Data, (uint256, string, string, string, uint32));
}

function getSendReviewProposalParamsData (TvmCell Data) external pure
         returns(uint256  proposalKind, address wallet, address propAddr, bool result, string comment)
{
         (proposalKind, wallet, propAddr, result, comment,) = abi.decode(Data,(uint256, address, address, bool, string, uint32));  
}

function getGoshDeployTaskProposalParamsData (TvmCell Data) external pure
         returns( uint256  proposalKind, string reponame, string taskname, string[] tag, ConfigGrant grant, optional(ConfigCommitBase) workers, string comment)
{
    (proposalKind, reponame, taskname, tag, grant, workers, comment,) = abi.decode(Data, (uint256, string, string, string[], ConfigGrant, optional(ConfigCommitBase), string, uint32));
}

function getUpgradeTaskProposalParamsData (TvmCell Data) external pure
         returns( uint256  proposalKind, string taskname, string reponame, string oldversion, address oldtask, string[] hashtag, string comment)
{
    (proposalKind, taskname, reponame, oldversion, oldtask, hashtag, comment,) = abi.decode(Data, (uint256, string, string, string, address, string[], string, uint32));
}

function getGoshDeployRepoProposalParamsData (TvmCell Data) external pure
         returns(uint256  proposalKind,  string repoName, string descr, optional(AddrVersion) previous, string comment)
{
    (proposalKind, repoName, descr, previous, comment,) = abi.decode(Data, (uint256, string, string, optional(AddrVersion), string, uint32));
}

function getGoshAddVoteTokenProposalParamsData (TvmCell Data) external pure
         returns(uint256  proposalKind,  address pubaddr, uint128 grant, string comment)
{
    (proposalKind, pubaddr, grant, comment, ) = abi.decode(Data, (uint256, address, uint128, string, uint32));
}

function getRedeployTaskProposalParamsData (TvmCell Data) external pure
         returns(uint256  proposalKind,  string repoName, string nameTask, string[] hashtag, TvmCell data)
{
    (proposalKind, repoName, nameTask, hashtag, data, ) = abi.decode(Data, (uint256, string, string, string[], TvmCell, uint32));
}

function getTaskData (TvmCell Data) external pure
         returns(string nametask, 
    	string repoName,
    	bool ready,
    	address systemcontract,
    	address dao,
    	ConfigCommitBase[] candidates,   
    	ConfigGrant grant,
    	string[] hashtag,
    	uint128 indexFinal,
    	uint128 locktime,
    	uint128 fullAssign,
    	uint128 fullReview,
    	uint128 fullManager,
    	mapping(address => uint128) _assigners,
    	mapping(address => uint128) _reviewers,
    	mapping(address => uint128) _managers,
    	uint128 assignfull,
    	uint128 reviewfull,
    	uint128 managerfull,
    	uint128 assigncomplete,
    	uint128 reviewcomplete,
    	uint128 managercomplete,
    	bool allassign,
    	bool allreview,
    	bool allmanager,
    	uint128 lastassign,
    	uint128 lastreview,
    	uint128 lastmanager,
    	uint128 balance)
{
    (nametask, repoName, ready, systemcontract, dao, candidates, grant, hashtag, indexFinal, locktime, fullAssign, fullReview, fullManager, _assigners, _reviewers, _managers, assignfull, reviewfull, managerfull, assigncomplete, reviewcomplete, managercomplete, allassign, allreview, allmanager, lastassign, lastreview, lastmanager, balance) = abi.decode(Data, (string, string, bool, address, address, ConfigCommitBase[], ConfigGrant, string[], uint128, uint128, uint128, uint128, uint128, mapping(address => uint128), mapping(address => uint128), mapping(address => uint128), uint128, uint128, uint128, uint128, uint128, uint128, bool, bool, bool, uint128, uint128, uint128, uint128));
}

function getGoshAddRegularTokenProposalParamsData (TvmCell Data) external pure
         returns(uint256  proposalKind,  address pubaddr, uint128 grant, string comment)
{
    (proposalKind, pubaddr, grant, comment, ) = abi.decode(Data, (uint256, address, uint128, string, uint32));
}

function getGoshMintTokenProposalParamsData (TvmCell Data) external pure
         returns(uint256  proposalKind,  uint128 grant, string comment)
{
    (proposalKind, grant, comment, ) = abi.decode(Data, (uint256, uint128, string, uint32));
}

function getGoshDaoTagProposalParamsData (TvmCell Data) external pure
         returns(uint256  proposalKind,  string[] daotag, string comment)
{
    (proposalKind, daotag, comment, ) = abi.decode(Data, (uint256, string[], string, uint32));
}

function getDaoSendTokenProposalParamsData (TvmCell Data) external pure
         returns(uint256 proposalKind, address wallet, optional(address) pubaddr, uint128 grant)
{
    (proposalKind, wallet, pubaddr, grant,,) = abi.decode(Data, (uint256, address, optional(address), uint128, string, uint32));
}

function getNotAllowMintProposalParamsData (TvmCell Data) external pure
         returns(uint256  proposalKind, string comment)
{
    (proposalKind, comment, ) = abi.decode(Data, (uint256, string, uint32));
}

function getChangeAllowanceProposalParamsData (TvmCell Data) external pure
         returns(uint256  proposalKind, address[] pubaddr, bool[] increase, uint128[] grant, string comment)
{
    (proposalKind, pubaddr, increase, grant, comment, ) = abi.decode(Data, (uint256, address[], bool[], uint128[], string, uint32));
}

function getAbilityInviteProposalParamsData (TvmCell Data) external pure
         returns(uint256  proposalKind, bool result)
{
         (proposalKind, result, ,) = abi.decode(Data,(uint256, bool, string, uint32));  
}

function getGoshRepoTagProposalParamsData (TvmCell Data) external pure
         returns(uint256  proposalKind,  string[] daotag, string repo, string comment)
{
    (proposalKind, daotag, repo, comment, ) = abi.decode(Data, (uint256, string[], string, string, uint32));
}

function getChangeDescriptionProposalParamsData (TvmCell Data) external pure
         returns(uint256  proposalKind,  string repo, string descr, string comment)
{
    (proposalKind, repo, descr, comment, ) = abi.decode(Data, (uint256, string, string, string, uint32));
}

function getChangeHideVotingResultProposalParamsData (TvmCell Data) external pure
         returns(uint256  proposalKind,  bool result, string comment)
{
    (proposalKind, result, comment, ) = abi.decode(Data, (uint256, bool, string, uint32));
}

function getChangeAllowDiscussionProposalParamsData (TvmCell Data) external pure
         returns(uint256  proposalKind,  bool result, string comment)
{
    (proposalKind, result, comment, ) = abi.decode(Data, (uint256, bool, string, uint32));
}

function getTagUpgradeProposalParamsData (TvmCell Data) external pure
         returns(uint proposalKind, string[] repoName, string[] nametag, string newversion) 
{
     (proposalKind, repoName, nametag, newversion, ,) = abi.decode(Data, (uint256, string[], string[], string, string, uint32));
}

function getDaoVoteProposalParamsData (TvmCell Data) external pure
         returns(uint proposalKind, address wallet, uint256 platform_id, bool choice, uint128 amount, uint128 num_clients_base, string note) 
{

     (proposalKind, wallet, platform_id, choice, amount, num_clients_base, note,,) = abi.decode(Data, (uint256, address, uint256, bool, uint128, uint128, string, string, uint32));
}

function getHalfData (TvmCell Data) external pure
        returns(TvmCell data1, TvmCell data2) {
    (data1, data2) = abi.decode(Data, (TvmCell, TvmCell));
}

function getDataFirst () external view 
        returns(uint128 num, TvmCell data0)
{
    (, num, data0, ) = abi.decode(propData,(uint256, uint128, TvmCell, uint32));
}                

function getDetails () external view 
        returns(uint256, optional (bool), uint32, uint32, uint32, uint128, uint128, uint128, uint256, mapping(address => bool))
{
    TvmSlice s = propData.toSlice();
    (uint256 proposalKind) = s.decode(uint256);
    return (proposalKind, votingResult, startTime, finishTime, realFinishTime, votesYes, votesNo, totalSupply, platform_id, reviewers);
}    
////////////////////////////////////

function tryEarlyComplete (uint128 t) internal virtual {}
function calcVotingResult (uint128 t) internal virtual {}

function continueUpdateHead (uint256 _platform_id) external override check_client(_platform_id)
{
     leftBro.reset();
/*    uint128 extra = _reserve (SMVConstants.PROPOSAL_MIN_BALANCE , SMVConstants.ACTION_FEE);

    if (extra > SMVConstants.VOTING_COMPLETION_FEE)
        ISMVProposal(address(this)).isCompleted {value: extra, flag: 1+2} ();
    else
        ISMVTokenLocker(tokenLocker).onHeadUpdated {value:SMVConstants.EPSILON_FEE, flag:1} (platform_id, address(this), amount_locked());
 */
    completeVoting();
    continueUpdateHeadHere();

}


/* function onProposalCompletedWhileUpdateHead (optional (bool) completed) external check_myself */
function continueUpdateHeadHere () internal view
{
    if (votingResult.hasValue())
    {
        ISMVTokenLocker(tokenLocker).onClientRemoved {value:SMVConstants.EPSILON_FEE, flag:1} (platform_id);
        if (rightBro.hasValue())
        {
            uint128 extra = _reserve (SMVConstants.PROPOSAL_MIN_BALANCE, SMVConstants.ACTION_FEE);
            LockableBase(rightBro.get()).continueUpdateHead {value: extra, flag: 1} (platform_id);
            //selfdestruct(smvAccount);
        }
        else
        {
            uint128 extra = _reserve (SMVConstants.PROPOSAL_MIN_BALANCE, SMVConstants.ACTION_FEE);
            optional (address) emptyAddress;
            optional (uint128) emptyValue;
            ISMVTokenLocker(tokenLocker).onHeadUpdated {value:extra, flag:1} (platform_id, emptyAddress, emptyValue);
        }
    }
    else
    {
        uint128 extra = _reserve (SMVConstants.PROPOSAL_MIN_BALANCE, SMVConstants.ACTION_FEE);
        ISMVTokenLocker(tokenLocker).onHeadUpdated {value:extra, flag:1} (platform_id, address(this), amount_locked());
    }
}

function updateHead() external override check_locker()
{
    require(isHead(), SMVErrors.error_i_am_not_head);
    require(address(this).balance >= SMVConstants.PROPOSAL_MIN_BALANCE +
                                     SMVConstants.VOTING_COMPLETION_FEE +
                                     2*SMVConstants.ACTION_FEE, SMVErrors.error_balance_too_low);

    completeVoting();
    continueUpdateHeadHere();
}

}

contract SMVProposal is SMVProposalBase {

function tryEarlyComplete (uint128 t) internal override
{
  uint128 y = votesYes;
  uint128 n = votesNo;
  if (2 * y > t) {
    votingResult.set(true) ;
    realFinishTime = block.timestamp;
  } else
    if (2 * n > t) {
        votingResult.set(false) ;
        realFinishTime = block.timestamp;
    }
}

function calcVotingResult (uint128 t) internal override
{
    uint128 y = votesYes;
    uint128 n = votesNo;
    votingResult.set(y >= 1 + (t/10) + ((n*((t/2)-(t/10)))/(t/2)));
}

}
