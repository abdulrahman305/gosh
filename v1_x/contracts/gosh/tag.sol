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

import "./modifiers/modifiers.sol";
import "./libraries/GoshLib.sol";
import "goshwallet.sol";

/* Root contract of tag */
contract Tag is Modifiers{
    string constant version = "1.0.0";
    
    string static _nametag;
    string _nameCommit;
    string _content;
    address _commit;
    address _pubaddr;
    address _systemcontract;
    address _goshdao;
    mapping(uint8 => TvmCell) _code;
    
    constructor(
        address pubaddr,
        string nameCommit, 
        address commit, 
        string content,
        address goshaddr,
        address goshdao,
        TvmCell WalletCode,
        uint128 index) public onlyOwner {
        require(_nametag != "", ERR_NO_DATA);
        tvm.accept();
        _code[m_WalletCode] = WalletCode;
        _systemcontract = goshaddr;
        _goshdao = goshdao;
        _pubaddr = pubaddr;
        require(checkAccess(pubaddr, msg.sender, index), ERR_SENDER_NO_ALLOWED);
        _nameCommit = nameCommit;
        _commit = commit;
        _content = content;
    }
    
    function checkAccess(address pubaddr, address sender, uint128 index) internal view returns(bool) {
        TvmCell s1 = _composeWalletStateInit(pubaddr, index);
        address addr = address.makeAddrStd(0, tvm.hash(s1));
        return addr == sender;
    }
    
    function _composeWalletStateInit(address pubaddr, uint128 index) internal view returns(TvmCell) {
        TvmCell deployCode = GoshLib.buildWalletCode(_code[m_WalletCode], pubaddr, version);
        TvmCell _contract = tvm.buildStateInit({
            code: deployCode,
            contr: GoshWallet,
            varInit: {_systemcontract : _systemcontract, _goshdao: _goshdao, _index: index}
        });
        return _contract;
    }
    
    //Selfdestruct
    function destroy(address pubaddr, uint128 index) public {
        require(checkAccess(pubaddr, msg.sender, index), ERR_SENDER_NO_ALLOWED);
        selfdestruct(giver);
    }
    
    //Getters
    function getCommit() external view returns(address) {
        return _commit;
    }
    
    function getContent() external view returns(string) {
        return _content;
    }
    
    function getVersion() external pure returns(string, string) {
        return ("tag", version);
    }
    
    function getOwner() external view returns(address) {
        return _pubaddr;
    }
}
