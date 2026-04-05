// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract DecisionLog {
    struct Decision {
        address agent;
        bytes32 decisionHash;
        string action;
        uint256 timestamp;
        string ipfsHash;
    }

    mapping(address => Decision[]) public agentDecisions;

    event DecisionLogged(
        address indexed agent,
        bytes32 indexed decisionHash,
        string action,
        uint256 timestamp
    );

    function logDecision(
        bytes32 _decisionHash,
        string calldata _action,
        string calldata _ipfsHash
    ) external {
        Decision memory d = Decision({
            agent: msg.sender,
            decisionHash: _decisionHash,
            action: _action,
            timestamp: block.timestamp,
            ipfsHash: _ipfsHash
        });
        agentDecisions[msg.sender].push(d);
        emit DecisionLogged(msg.sender, _decisionHash, _action, block.timestamp);
    }

    function getDecisionCount(address agent) external view returns (uint256) {
        return agentDecisions[agent].length;
    }

    function getDecision(address agent, uint256 index) external view returns (Decision memory) {
        return agentDecisions[agent][index];
    }
}
