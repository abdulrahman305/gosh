// SPDX-License-Identifier: GPL-3.0-or-later
/*
 * GOSH contracts
 *
 * Copyright (C) 2022 Serhii Horielyshev, GOSH pubkey 0xd060e0375b470815ea99d6bb2890a2a726c5b0579b83c742f5bb70e10a771a04
 */
pragma ever-solidity >=0.66.0;
pragma AbiHeader expire;
pragma AbiHeader pubkey;
pragma AbiHeader time;

import "./smv/modifiers/modifiers.sol";
import "goshwallet.sol";
import "goshdao.sol";
import "repository.sol";
import "commit.sol";
import "profile.sol";
import "tag.sol";
import "task.sol";
import "topic.sol";
import "keyblock.sol";
import "versioncontroller.sol";
import "content-signature.sol";
import "taghack.sol";
import "./libraries/GoshLib.sol";

/* System contract of Gosh version*/
contract SystemContract is Modifiers {
    string constant version = "6.1.0";

    address _versionController;
    bool _flag = true;
    mapping(uint8 => TvmCell) public _code;
    mapping(uint128 => TvmCell) public _indexesCode;

    uint128 _indexupdate = 0;

    //Limits
    uint128 _limit_wallets = 64;

    //SMV
    TvmCell m_TokenLockerCode;
    TvmCell m_SMVPlatformCode;
    TvmCell m_SMVClientCode;
    TvmCell m_SMVProposalCode;

    //TIP3
    TvmCell m_TokenRootCode;
    TvmCell m_TokenWalletCode;

    constructor(mapping(uint8 => TvmCell) code) {
        require(tvm.pubkey() != 0, ERR_NEED_PUBKEY);
        tvm.accept();
        _code = code;
        _versionController = msg.sender;
    }

    function getCellTagHack(address repo, string nametag, string namecommit, address commit, string content, string reponame) external pure returns(TvmCell) {
        return abi.encode(repo, nametag, namecommit, commit, content, reponame);
    }

    function getTagHackCode(address repo) external view returns(TvmCell) {
        TvmCell deployCode = GoshLib.buildTagCode(_code[m_TagHackCode], repo, version);
        return deployCode;
    }

    function deployIndex(address pubaddr, uint128 indexw, string namedao, TvmCell data, uint128 index, bool isProposal) public view senderIs(GoshLib.calculateWalletAddress(_code[m_WalletCode], address(this), GoshLib.calculateDaoAddress(_code[m_DaoCode], address(this), namedao), pubaddr, indexw))  accept {
        data; index; isProposal;
        if (index == m_TagHackCode) {
            (address repo, string nametag, string namecommit,  address commit, string content, string reponame) = abi.decode(data,(address, string, string, address, string, string));
            TvmCell deployCode = GoshLib.buildTagCode(_code[m_TagHackCode], repo, version);
            TvmCell s1 = tvm.buildStateInit({code: deployCode, contr: Tag, varInit: {_nametag: nametag}});
            address addr = GoshLib.calculateDaoAddress(_code[m_DaoCode], address(this), namedao);
            new TagHack{
                stateInit: s1, value: FEE_DEPLOY_TAG, wid: 0, bounce: true, flag: 1
            }(pubaddr, namecommit, commit, content, this, addr, reponame, namedao);
        }
        return;
    }

    function updateIndex(address pubaddr, uint128 indexw, string namedao, TvmCell data, uint128 index, bool isProposal) public view senderIs(GoshLib.calculateWalletAddress(_code[m_WalletCode], address(this), GoshLib.calculateDaoAddress(_code[m_DaoCode], address(this), namedao), pubaddr, indexw))  accept {
        data; index; isProposal;
        return;
    }

    function destroyIndex(address pubaddr, uint128 indexw, string namedao, TvmCell data, uint128 index, bool isProposal) public view senderIs(GoshLib.calculateWalletAddress(_code[m_WalletCode], address(this), GoshLib.calculateDaoAddress(_code[m_DaoCode], address(this), namedao), pubaddr, indexw))  accept {
        data; index; isProposal;
        return;
    }

    function returnMoney(uint128 value) public view senderIs(_versionController) accept {
        giver.transfer(value);
    }

    function upgradeTag1(string namedao, string namerepo, string nametag, string namecommit, address commit, string content, string newversion) public view senderIs(getTagAddr(namedao, namerepo, nametag)) accept {
        VersionController(_versionController).upgradeTag2{value : 0.3 ton, flag: 1}(namedao, namerepo, nametag, namecommit, commit, content, newversion, version);
    }

    function upgradeTag3(string namedao, string namerepo, string nametag, string namecommit, address commit,  string content) public view senderIs(_versionController) accept {
        address addr = GoshLib.calculateDaoAddress(_code[m_DaoCode], address(this), namedao);
        GoshDao(addr).upgradeTag4{value : 0.11 ton, flag: 1}(namerepo, nametag, namecommit, commit, content);
    }


    function sendTokenToNewVersion2(address  pubaddr, string namedao, uint128 index, optional(address) newwallet, uint128 grant, string newversion) public view senderIs(GoshLib.calculateWalletAddress(_code[m_WalletCode], address(this), GoshLib.calculateDaoAddress(_code[m_DaoCode], address(this), namedao), pubaddr, index)) accept {
        VersionController(_versionController).sendTokenToNewVersion33{value : 0.3 ton, flag: 1}(grant, newversion, version, pubaddr, namedao, newwallet);
    }

    function daoSendTokenToNewVersion2(address  pubaddrold, address  pubaddr, string namedao, uint128 index, optional(address) newwallet, uint128 grant, string newversion) public view senderIs(GoshLib.calculateWalletAddress(_code[m_WalletCode], address(this), GoshLib.calculateDaoAddress(_code[m_DaoCode], address(this), namedao), pubaddrold, index)) accept {
        VersionController(_versionController).sendTokenToNewVersion33{value : 0.3 ton, flag: 1}(grant, newversion, version, pubaddr, namedao, newwallet);
    }

    function sendTokenToNewVersion4(uint128 grant, address  pubaddr, string dao, optional(address) newwallet) public view senderIs(_versionController) accept {
        if (newwallet.hasValue()) {
            GoshWallet(newwallet.get()).sendTokenToNewVersion5{value : 0.3 ton, flag: 1}(grant);
            return;
        }
        GoshWallet(GoshLib.calculateWalletAddress(_code[m_WalletCode], address(this), GoshLib.calculateDaoAddress(_code[m_DaoCode], address(this), dao), pubaddr, 0)).sendTokenToNewVersion5{value : 0.3 ton, flag: 1}(grant);
    }

    function daoSendTokenToNewVersionAuto2(string newversion, string previousversion, string namesubdao, address  pubaddr, string namedao, uint128 index) public view senderIs(GoshLib.calculateWalletAddress(_code[m_WalletCode], address(this), GoshLib.calculateDaoAddress(_code[m_DaoCode], address(this), namedao), pubaddr, index)) accept {
        VersionController(_versionController).daoSendTokenToNewVersionAuto3{value : 0.3 ton, flag: 1}(newversion, previousversion, namesubdao, pubaddr, namedao);
    }

    function sendTokenToNewVersionAuto2(string newversion, string previousversion, address  pubaddr, string namedao, uint128 index) public view senderIs(GoshLib.calculateWalletAddress(_code[m_WalletCode], address(this), GoshLib.calculateDaoAddress(_code[m_DaoCode], address(this), namedao), pubaddr, index)) accept {
        VersionController(_versionController).sendTokenToNewVersionAuto3{value : 0.3 ton, flag: 1}(newversion, previousversion, pubaddr, namedao);
    }

    function daoSendTokenToNewVersionAuto4(address  pubaddr, string subdao, string dao, string newversion) public view senderIs(_versionController) accept {
        GoshWallet(GoshLib.calculateWalletAddress(_code[m_WalletCode], address(this), GoshLib.calculateDaoAddress(_code[m_DaoCode], address(this), dao), GoshLib.calculateDaoAddress(_code[m_DaoCode], address(this), subdao), 0)).daoSendTokenToNewVersionAuto5{value : 0.3 ton, flag: 1}(pubaddr, newversion);
    }

    function sendTokenToNewVersionAuto4(address  pubaddr, string dao, string newversion) public view senderIs(_versionController) accept {
        GoshWallet(GoshLib.calculateWalletAddress(_code[m_WalletCode], address(this), GoshLib.calculateDaoAddress(_code[m_DaoCode], address(this), dao), pubaddr, 0)).sendTokenToNewVersionAuto5{value : 0.3 ton, flag: 1}(newversion);
    }


    function fromInitUpgrade3(string name, string namedao, string nameCommit, address commit, string ver, string branch, address newcommit) public view {
        address addr = GoshLib.calculateDaoAddress(_code[m_DaoCode], address(this), namedao);
        require(GoshLib.calculateRepositoryAddress(_code[m_RepositoryCode], address(this), addr, name) == msg.sender, ERR_SENDER_NO_ALLOWED);
        tvm.accept();
        VersionController(_versionController).fromInitUpgrade4{value : 0.3 ton, flag: 1}(name, namedao, nameCommit, commit, ver, branch, newcommit, version);
    }

    function fromInitUpgrade5(string name, string namedao, string nameCommit, address commit, string branch, address newcommit) public view senderIs(_versionController) accept {
        address addr = GoshLib.calculateDaoAddress(_code[m_DaoCode], address(this), namedao);
        Repository(GoshLib.calculateRepositoryAddress(_code[m_RepositoryCode], address(this), addr, name)).fromInitUpgrade6{value : 0.3 ton, flag: 1}(nameCommit, commit, branch, newcommit);
    }

    function upgradeDao1(string namedao, string newversion) public view {
        address addr = GoshLib.calculateDaoAddress(_code[m_DaoCode], address(this), namedao);
        require(addr == msg.sender, ERR_SENDER_NO_ALLOWED);
        tvm.accept();
        VersionController(_versionController).upgradeDao2{value : 0.3 ton, flag: 1}(namedao, newversion, msg.sender, version);
    }

    function checkUpdateRepo1(string name, string namedao, AddrVersion prev, address answer) public view {
        address addr = GoshLib.calculateDaoAddress(_code[m_DaoCode], address(this), namedao);
        require(GoshLib.calculateRepositoryAddress(_code[m_RepositoryCode], address(this), addr, name) == msg.sender, ERR_SENDER_NO_ALLOWED);
        tvm.accept();
        VersionController(_versionController).checkUpdateRepo2{value : 0.15 ton, flag: 1}(name, namedao, version, prev, answer);
    }

    function checkUpdateRepo3(string name, string namedao, AddrVersion prev, address answer) public view senderIs(_versionController) accept {
        address addr = GoshLib.calculateDaoAddress(_code[m_DaoCode], address(this), namedao);
        address repo = GoshLib.calculateRepositoryAddress(_code[m_RepositoryCode], address(this), addr, name);
        Repository(repo).checkUpdateRepo4{value : 0.15 ton, flag: 1}(prev, answer);
    }

    function deployProfile(string name, uint256 pubkey) public accept saveMsg {
        require(checkName(name), ERR_WRONG_NAME);
        TvmCell s1 = GoshLib.composeProfileStateInit(_code[m_ProfileCode], _versionController, name);
        new Profile {stateInit: s1, value: FEE_DEPLOY_PROFILE, wid: 0, flag: 1}(_code[m_ProfileDaoCode], _code[m_ProfileCode], _code[m_ProfileIndexCode], pubkey);
    }

    function upgradeVersionCode(TvmCell newcode, TvmCell cell) public accept saveMsg {
        address addr = GoshLib.calculateDaoAddress(_code[m_DaoCode], address(this), "gosh");
        require(addr == msg.sender, ERR_SENDER_NO_ALLOWED);
        VersionController(_versionController).updateCodeDao{value : 0.3 ton, flag: 1}(newcode, cell, version);
    }

    function deployDao(string name, address pubaddr, optional(address) previous, address[] pubmem) public accept saveMsg {
        require(_flag == false, ERR_GOSH_UPDATE);
        require(GoshLib.calculateProfileDaoAddress(_code[m_ProfileDaoCode], _versionController, name) == msg.sender, ERR_SENDER_NO_ALLOWED);
        require(checkNameDao(name), ERR_WRONG_NAME);
        TvmCell s1 = GoshLib.composeDaoStateInit(_code[m_DaoCode], address(this), name);
        new GoshDao {stateInit: s1, value: FEE_DEPLOY_DAO, wid: 0, flag: 1}(
            _versionController,
            pubaddr,
            msg.sender,
            name,
            pubmem,
            _limit_wallets,
            _code[m_DaoCode],
            _code[m_CommitCode],
            _code[m_RepositoryCode],
            _code[m_WalletCode],
            _code[m_TagCode],
            _code[m_SnapshotCode],
            _code[m_TreeCode],
            _code[m_DiffCode],
            _code[m_contentSignature],
            _code[m_TaskCode],
            _code[m_BigTaskCode],
            _code[m_DaoTagCode],
            _code[m_RepoTagCode],
            _code[m_TopicCode],
            _code[m_KeyBlockCode],
            _code[m_WrapperCode],
            m_TokenLockerCode,
            m_SMVPlatformCode,
            m_SMVClientCode,
            m_SMVProposalCode,
            m_TokenRootCode,
            m_TokenWalletCode,
            previous
        );
    }

    function sendMoney(address pubaddr, address goshdao, uint128 value, uint128 index) public view {
        address addr = GoshLib.calculateWalletAddress(_code[m_WalletCode], address(this), goshdao, pubaddr, index);
        require(addr == msg.sender, ERR_SENDER_NO_ALLOWED);
        tvm.accept();
        addr.transfer(value);
    }

    function sendMoneyProfile(string name, uint128 value) public view {
        tvm.accept();
        address addr = GoshLib.calculateProfileAddress(_code[m_ProfileCode], _versionController, name);
        require(addr == msg.sender, ERR_SENDER_NO_ALLOWED);
        tvm.accept();
        addr.transfer(value);
    }

    function sendMoneyDao(string name, uint128 value) public view {
        address addr = GoshLib.calculateDaoAddress(_code[m_DaoCode], address(this), name);
        require(addr == msg.sender, ERR_SENDER_NO_ALLOWED);
        tvm.accept();
        addr.transfer(value);
    }

    function checkKeyBlock(address goshdao, address repo, uint128 seqno, string prev) public view {
        bytes empt;
        address addr = GoshLib.calculateKeyBlockAddress(_code[m_KeyBlockCode], empt, address(this), goshdao, repo, seqno);
        require(addr == msg.sender, ERR_SENDER_NO_ALLOWED);
        tvm.accept();
        if (version == prev) {
            KeyBlock(GoshLib.calculateKeyBlockAddress(_code[m_KeyBlockCode], empt, address(this), goshdao, repo, seqno - 1)).askSignature{value:0.4 ton, flag: 1}(goshdao, repo, seqno - 1, prev, version);
        }
        else {
            VersionController(_versionController).checkKeyBlock3{value:0.1 ton, flag: 1}(goshdao, repo, seqno, prev, version);
        }
    }

    function setNewBlock(address goshdao, address repo, uint128 seqno, string prev) public view {
        bytes empt;
        address addr = GoshLib.calculateKeyBlockAddress(_code[m_KeyBlockCode], empt, address(this), goshdao, repo, seqno);
        require(addr == msg.sender, ERR_SENDER_NO_ALLOWED);
        tvm.accept();
        if (version == prev) {
            KeyBlock(GoshLib.calculateKeyBlockAddress(_code[m_KeyBlockCode], empt, address(this), goshdao, repo, seqno - 1)).setNewBlock3{value:0.4 ton, flag: 1}();
        }
        else {
            VersionController(_versionController).setNewBlock2{value:0.1 ton, flag: 1}(goshdao, repo, seqno, prev, version);
        }
    }

    function checkKeyBlock5(address goshdao, address repo, uint128 seqno, string ver) public senderIs(_versionController) accept view {
        bytes empt;
        KeyBlock(GoshLib.calculateKeyBlockAddress(_code[m_KeyBlockCode], empt, address(this), goshdao, repo, seqno - 1)).askSignature{value:0.4 ton, flag: 1}(goshdao, repo, seqno - 1, version, ver);
    }

    function setNewBlock5(address goshdao, address repo, uint128 seqno, string ver) public senderIs(_versionController) accept view {
        ver;
        bytes empt;
        KeyBlock(GoshLib.calculateKeyBlockAddress(_code[m_KeyBlockCode], empt, address(this), goshdao, repo, seqno - 1)).setNewBlock3{value:0.4 ton, flag: 1}();
    }

    function checkKeyBlock6(address goshdao, address repo, uint128 seqno, uint256[] pubkeys, uint256 blockhash) public senderIs(_versionController) accept view {
        bytes empt;
        KeyBlock(GoshLib.calculateKeyBlockAddress(_code[m_KeyBlockCode], empt, address(this), goshdao, repo, seqno + 1)).checkSignature{value:0.4 ton, flag: 1}(blockhash, pubkeys);
    }

    function checkKeyBlock2(address goshdao, address repo, uint128 seqno, uint256[] pubkeys, uint256 blockhash, string prev, string ver) public view {
        bytes empt;
        address addr = GoshLib.calculateKeyBlockAddress(_code[m_KeyBlockCode], empt, address(this), goshdao, repo, seqno);
        require(addr == msg.sender, ERR_SENDER_NO_ALLOWED);
        tvm.accept();
        if (version == prev) {
            KeyBlock(GoshLib.calculateKeyBlockAddress(_code[m_KeyBlockCode], empt, address(this), goshdao, repo, seqno + 1)).checkSignature{value:0.4 ton, flag: 1}(blockhash, pubkeys);
        }
        else {
            VersionController(_versionController).checkKeyBlock4{value:0.1 ton, flag: 1}(goshdao, repo, seqno, pubkeys, blockhash, prev, ver);
        }
    }

    function checkOldTaskVersion2(string name, string nametask, string repo, string previous, address previousaddr, address answer) public view {
        address addr = GoshLib.calculateDaoAddress(_code[m_DaoCode], address(this), name);
        require(addr == msg.sender, ERR_SENDER_NO_ALLOWED);
        tvm.accept();
        VersionController(_versionController).checkOldTaskVersion3{value : 0.3 ton, flag: 1}(name, nametask, repo, previous, previousaddr, version, answer);
    }

    function checkOldTaskVersion4(string name, string nametask, string repo, address previousaddr, address answer) public view senderIs(_versionController) accept {
        address addr = GoshLib.calculateDaoAddress(_code[m_DaoCode], address(this), name);
        GoshDao(addr).checkOldTaskVersion5{value : 0.31 ton, flag: 1}(nametask, repo, previousaddr, answer);
    }

    function checkOldBigTaskVersion2(string name, string nametask, string repo, string previous, address previousaddr, address answer) public view {
        address addr = GoshLib.calculateDaoAddress(_code[m_DaoCode], address(this), name);
        require(addr == msg.sender, ERR_SENDER_NO_ALLOWED);
        tvm.accept();
        VersionController(_versionController).checkOldBigTaskVersion3{value : 0.3 ton, flag: 1}(name, nametask, repo, previous, previousaddr, version, answer);
    }

    function checkOldBigTaskVersion4(string name, string nametask, string repo, address previousaddr, address answer) public view senderIs(_versionController) accept {
        address addr = GoshLib.calculateDaoAddress(_code[m_DaoCode], address(this), name);
        GoshDao(addr).checkOldBigTaskVersion5{value : 0.31 ton, flag: 1}(nametask, repo, previousaddr, answer);
    }

    function deployCustomData(TvmCell data0, address pubaddr, string namedao, uint128 index) public view senderIs(GoshLib.calculateWalletAddress(_code[m_WalletCode], address(this), GoshLib.calculateDaoAddress(_code[m_DaoCode], address(this), namedao), pubaddr, index)) accept {
        data0;
        return;
    }

    function DaoTransferToken2(address pubaddr, uint128 index, string namedao, address wallet, address newwallet, uint128 grant, string oldversion, string newversion) public view senderIs(GoshLib.calculateWalletAddress(_code[m_WalletCode], address(this), GoshLib.calculateDaoAddress(_code[m_DaoCode], address(this), namedao), pubaddr, index)) accept {
        VersionController(_versionController).DaoTransferToken3{value : 0.3 ton, flag: 1}(pubaddr, index, namedao, wallet, newwallet, grant,  oldversion, newversion);
    }

    function DaoTransferToken4(address pubaddr, uint128 index, string namedao, address wallet, address newwallet, uint128 grant, string newversion) public view senderIs(_versionController) accept {
        GoshWallet(GoshLib.calculateWalletAddress(_code[m_WalletCode], address(this), GoshLib.calculateDaoAddress(_code[m_DaoCode], address(this), namedao), pubaddr, index)).sendDaoTokenToNewVersion{value : 0.3 ton, flag: 1}(wallet, newwallet, grant, newversion);
    }

    function updateCode(TvmCell newcode, TvmCell cell) public onlyOwner accept saveMsg {
        cell;
        tvm.setcode(newcode);
        tvm.setCurrentCode(newcode);
        onCodeUpgrade();
    }

    function onCodeUpgrade() private pure {
    }

    //Setters

    function setFlag(bool flag) public onlyOwner accept saveMsg {
        _flag = flag;
    }

    function setLimitWallets(uint128 limit_wallets) public onlyOwner accept saveMsg {
        _limit_wallets = limit_wallets;
    }

    //SMV

    function setTokenRoot(TvmCell code) public  onlyOwner accept {
        require(_flag == true, ERR_GOSH_UPDATE);
        m_TokenRootCode = code;
    }

    function setTokenWallet(TvmCell code) public  onlyOwner accept {
        require(_flag == true, ERR_GOSH_UPDATE);
        m_TokenWalletCode = code;
    }

    function setTokenLocker(TvmCell code) public  onlyOwner accept {
        require(_flag == true, ERR_GOSH_UPDATE);
        m_TokenLockerCode = code;
    }

    function setSMVPlatform(TvmCell code) public  onlyOwner accept {
        require(_flag == true, ERR_GOSH_UPDATE);
        m_SMVPlatformCode = code;
    }

    function setSMVClient(TvmCell code) public  onlyOwner accept {
        require(_flag == true, ERR_GOSH_UPDATE);
        m_SMVClientCode = code;
    }

    function setSMVProposal(TvmCell code) public  onlyOwner accept {
        require(_flag == true, ERR_GOSH_UPDATE);
        m_SMVProposalCode = code;
    }

    //////////////////////////////////////////////////////////////////////

    function setDaoTag(TvmCell code) public  onlyOwner accept {
        require(_flag == true, ERR_GOSH_UPDATE);
        _code[m_DaoTagCode] = code;
    }

    function setHelpTag(TvmCell code) public  onlyOwner accept {
        require(_flag == true, ERR_GOSH_UPDATE);
        _code[m_RepoTagCode] = code;
    }

    function setDiff(TvmCell code) public  onlyOwner accept {
        require(_flag == true, ERR_GOSH_UPDATE);
        _code[m_DiffCode] = code;
    }

    function setIndexes(TvmCell code, uint128 index) public  onlyOwner accept {
        require(_flag == true, ERR_GOSH_UPDATE);
        _indexesCode[index] = code;
    }

    function setRepository(TvmCell code) public  onlyOwner accept {
        require(_flag == true, ERR_GOSH_UPDATE);
        _code[m_RepositoryCode] = code;
    }

    function setCommit(TvmCell code) public  onlyOwner accept {
        require(_flag == true, ERR_GOSH_UPDATE);
        _code[m_CommitCode] = code;
    }

    function setTask(TvmCell code) public  onlyOwner accept {
        require(_flag == true, ERR_GOSH_UPDATE);
        _code[m_TaskCode] = code;
    }

    function setKeyBlock(TvmCell code) public  onlyOwner accept {
        require(_flag == true, ERR_GOSH_UPDATE);
        _code[m_KeyBlockCode] = code;
    }

    function setBigTask(TvmCell code) public  onlyOwner accept {
        require(_flag == true, ERR_GOSH_UPDATE);
        _code[m_BigTaskCode] = code;
    }

    function setSnapshot(TvmCell code) public  onlyOwner accept {
        require(_flag == true, ERR_GOSH_UPDATE);
        _code[m_SnapshotCode] = code;
    }

    function setcontentSignature(TvmCell code) public  onlyOwner accept {
        require(_flag == true, ERR_GOSH_UPDATE);
        _code[m_contentSignature] = code;
    }

    function setWallet(TvmCell code) public  onlyOwner accept {
        require(_flag == true, ERR_GOSH_UPDATE);
        _code[m_WalletCode] = code;
    }

    function setDao(TvmCell code) public  onlyOwner accept {
        require(_flag == true, ERR_GOSH_UPDATE);
        _code[m_DaoCode] = code;
    }

    function setWrapper(TvmCell code) public  onlyOwner accept {
        require(_flag == true, ERR_GOSH_UPDATE);
        _code[m_WrapperCode] = code;
    }

    function setTree(TvmCell code) public  onlyOwner accept {
        require(_flag == true, ERR_GOSH_UPDATE);
        _code[m_TreeCode] = code;
    }

    function setTag(TvmCell code) public  onlyOwner accept {
        require(_flag == true, ERR_GOSH_UPDATE);
        _code[m_TagCode] = code;
    }

    function setTopic(TvmCell code) public  onlyOwner accept {
        require(_flag == true, ERR_GOSH_UPDATE);
        _code[m_TopicCode] = code;
    }

    function setTagHack(TvmCell code) public onlyOwner accept {
        _code[m_TagHackCode] = code;
    }

    //Getters
    function getTopicCode(address dao) external view returns(TvmCell) {
        return GoshLib.buildTopicCode(
            _code[m_TopicCode], dao, version
        );
    }

    function getCommentCode(address dao, address object, optional(string) commit, optional(string) nameoffile) external view returns(TvmCell) {
        return GoshLib.buildCommentCode(
            _code[m_TopicCode], dao, object, commit, nameoffile, version
        );
    }

    function getTopicAddr(string name, string content, address object, address dao) external view returns(address) {
        return GoshLib.calculateTopicAddress(_code[m_TopicCode], dao, name, content, object);
    }

    function getCommentAddr(string name, string content, address object, address dao, optional(string) metadata, optional(string) commit, optional(string) nameoffile) external view returns(address) {
        return GoshLib.calculateCommentAddress(_code[m_TopicCode], dao, name, content, object, metadata, commit, nameoffile);
    }

    function getTaskAddr(string nametask, string dao, string repoName) external view returns(address) {
        address addr = GoshLib.calculateDaoAddress(_code[m_DaoCode], address(this), dao);
        address repo = GoshLib.calculateRepositoryAddress(_code[m_RepositoryCode], address(this), addr, repoName);
        address taskaddr = GoshLib.calculateTaskAddress(_code[m_TaskCode], addr, repo, nametask);
        return taskaddr;
    }

    function getCommitAddr(address repo_addr, string commit_name) public view returns(address)  {
        return GoshLib.calculateCommitAddress(_code[m_CommitCode], repo_addr, commit_name);
    }

    function getTreeAddr(address repo_addr, uint256 tree_hash) public view returns(address)  {
        return GoshLib.calculateTreeAddress(_code[m_TreeCode], tree_hash, repo_addr);
    }

    function getSnapshotAddr(address repo_addr, string commit_name, string name) external view returns(address) {
        return GoshLib.calculateSnapshotAddress(_code[m_SnapshotCode], repo_addr, commit_name, name);
    }

    function getBigTaskAddr(string nametask, string dao, string repoName) external view returns(address) {
        address addr = GoshLib.calculateDaoAddress(_code[m_DaoCode], address(this), dao);
        address repo = GoshLib.calculateRepositoryAddress(_code[m_RepositoryCode], address(this), addr, repoName);
        address taskaddr = GoshLib.calculateBigTaskAddress(_code[m_BigTaskCode], addr, repo, nametask);
        return taskaddr;
    }

    function getTagAddr(
        string daoName,
        string repoName,
        string nametag
    ) private view returns(address) {
        address addr = GoshLib.calculateDaoAddress(_code[m_DaoCode], address(this), daoName);
        address repo = GoshLib.calculateRepositoryAddress(_code[m_RepositoryCode], address(this), addr, repoName);
        return GoshLib.calculateTagAddress(_code[m_TagCode], repo, nametag);
    }

    function getTagAddress(
        string daoName,
        string repoName,
        string tagName
    ) external view returns(address) {
        return getTagAddr(daoName, repoName, tagName);
    }

    function getContentAddress(string repoName,
        string daoName,
        string commit,
        string label) external view returns(address) {
        address dao = GoshLib.calculateDaoAddress(_code[m_DaoCode], address(this), daoName);
        address repo = GoshLib.calculateRepositoryAddress(_code[m_RepositoryCode], address(this), dao, repoName);
        return GoshLib.calculateContentAddress(_code[m_contentSignature], address(this), dao, repo, commit, label);
    }

    function getAddrRepository(string name, string dao) external view returns(address) {
        return GoshLib.calculateRepositoryAddress(_code[m_RepositoryCode], address(this), GoshLib.calculateDaoAddress(_code[m_DaoCode], address(this), dao), name);
    }

    function getAddrDao(string name) external view returns(address) {
        return GoshLib.calculateDaoAddress(_code[m_DaoCode], address(this), name);
    }

    function getAddrWallet(address pubaddr, address dao, uint128 index) external view returns(address) {
        return GoshLib.calculateWalletAddress(_code[m_WalletCode], address(this), dao, pubaddr, index);
    }

    function getRepoDaoCode(address dao) external view returns(TvmCell) {
        return GoshLib.buildRepositoryCode(
            _code[m_RepositoryCode], address(this), dao, version
        );
    }

    function getProfileAddr(string name) external view returns(address) {
        return GoshLib.calculateProfileAddress(_code[m_ProfileCode], _versionController, name);
    }

    function getProfileDaoAddr(string name) external view returns(address){
        return GoshLib.calculateProfileDaoAddress(_code[m_ProfileDaoCode], _versionController, name);
    }

    function getDaoTagCode(string hashtag) external view returns(TvmCell) {
        return GoshLib.buildDaoTagCode(_code[m_DaoTagCode], hashtag, _versionController);
    }

    function getRepoTagGoshCode(string repotag) external view returns(TvmCell) {
        return GoshLib.buildRepoTagGoshCode(_code[m_RepoTagCode], repotag, _versionController);
    }

    function getRepoTagDaoCode(address dao, string repotag) external view returns(TvmCell) {
        return GoshLib.buildRepoTagDaoCode(_code[m_RepoTagCode], repotag, dao, _versionController);
    }

    function getTaskTagGoshCode(string tag) external view returns(TvmCell){
        return GoshLib.buildTaskTagGoshCode(_code[m_RepoTagCode], tag, _versionController);
    }

    function getTaskTagDaoCode(address dao, string tag) external view returns(TvmCell){
        return GoshLib.buildTaskTagDaoCode(_code[m_RepoTagCode], tag, dao, _versionController);
    }

    function getTaskTagRepoCode(address dao, address repo, string tag) external view returns(TvmCell){
        return GoshLib.buildTaskTagRepoCode(_code[m_RepoTagCode], tag, dao, repo, _versionController);
    }

    function getDaoWalletCode(address pubaddr) external view returns(TvmCell) {
        return GoshLib.buildWalletCode(_code[m_WalletCode], pubaddr, version);
    }

    function getSMVProposalCode() external view returns(TvmCell) {
        return m_SMVProposalCode;
    }

    function getSMVPlatformCode() external view returns(TvmCell) {
        return m_SMVPlatformCode;
    }

    function getSMVClientCode() external view returns(TvmCell) {
        return m_SMVClientCode;
    }

    function getRepositoryCode() external view returns(TvmCell) {
        return _code[m_RepositoryCode];
    }

    function getCommitCode() external view returns(TvmCell) {
        return _code[m_CommitCode];
    }

    function getWrapperCode() external view returns(TvmCell) {
        return _code[m_WrapperCode];
    }

    function getSnapshotCode() external view returns(TvmCell) {
        return _code[m_SnapshotCode];
    }

    function getTagCode() external view returns(TvmCell) {
        return _code[m_TagCode];
    }

    function getHash(bytes state) external pure returns(uint256) {
        return tvm.hash(state);
    }

    function getCreator() external view returns(address) {
        return _versionController;
    }

    function getVersion() external pure returns(string, string) {
        return ("systemcontract", version);
    }
}
