export const DECISION_LOG_ABI = [
  {
    type: "function",
    name: "logDecision",
    inputs: [
      { name: "_decisionHash", type: "bytes32", internalType: "bytes32" },
      { name: "_action", type: "string", internalType: "string" },
      { name: "_ipfsHash", type: "string", internalType: "string" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "getDecisionCount",
    inputs: [{ name: "agent", type: "address", internalType: "address" }],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getDecision",
    inputs: [
      { name: "agent", type: "address", internalType: "address" },
      { name: "index", type: "uint256", internalType: "uint256" },
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        internalType: "struct DecisionLog.Decision",
        components: [
          { name: "agent", type: "address", internalType: "address" },
          { name: "decisionHash", type: "bytes32", internalType: "bytes32" },
          { name: "action", type: "string", internalType: "string" },
          { name: "timestamp", type: "uint256", internalType: "uint256" },
          { name: "ipfsHash", type: "string", internalType: "string" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "event",
    name: "DecisionLogged",
    inputs: [
      { name: "agent", type: "address", indexed: true, internalType: "address" },
      { name: "decisionHash", type: "bytes32", indexed: true, internalType: "bytes32" },
      { name: "action", type: "string", indexed: false, internalType: "string" },
      { name: "timestamp", type: "uint256", indexed: false, internalType: "uint256" },
    ],
    anonymous: false,
  },
] as const;
