// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

contract MLedgerSettlementRegistry {
    enum Currency {
        KES,
        USD,
        USDC
    }

    enum Status {
        None,
        Pending,
        Confirmed,
        Cancelled
    }

    struct SettlementRecord {
        bytes32 invoiceReferenceHash;
        bytes32 detailsHash;
        uint128 amount;
        Currency sourceCurrency;
        Currency destinationCurrency;
        Status status;
        address recordedBy;
        uint64 createdAt;
    }

    address public owner;
    mapping(address operator => bool enabled) public operators;
    mapping(bytes32 settlementId => SettlementRecord record) public settlements;

    error Unauthorized();
    error ZeroAddress();
    error InvalidHash();
    error InvalidAmount();
    error SettlementAlreadyExists();
    error SettlementNotPending();

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event OperatorUpdated(address indexed operator, bool enabled);
    event SettlementRecorded(
        bytes32 indexed settlementId,
        bytes32 indexed invoiceReferenceHash,
        uint128 amount,
        Currency sourceCurrency,
        Currency destinationCurrency,
        address indexed recordedBy
    );
    event SettlementStatusUpdated(bytes32 indexed settlementId, Status status, address indexed updatedBy);

    constructor() {
        owner = msg.sender;
        operators[msg.sender] = true;
        emit OwnershipTransferred(address(0), msg.sender);
        emit OperatorUpdated(msg.sender, true);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier onlyOperator() {
        if (!operators[msg.sender]) revert Unauthorized();
        _;
    }

    function setOperator(address operator, bool enabled) external onlyOwner {
        if (operator == address(0)) revert ZeroAddress();
        operators[operator] = enabled;
        emit OperatorUpdated(operator, enabled);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        address previousOwner = owner;
        owner = newOwner;
        operators[previousOwner] = false;
        operators[newOwner] = true;
        emit OwnershipTransferred(previousOwner, newOwner);
        emit OperatorUpdated(previousOwner, false);
        emit OperatorUpdated(newOwner, true);
    }

    function recordSettlement(
        bytes32 settlementId,
        bytes32 invoiceReferenceHash,
        bytes32 detailsHash,
        uint128 amount,
        Currency sourceCurrency,
        Currency destinationCurrency
    ) external onlyOperator {
        if (settlementId == bytes32(0) || invoiceReferenceHash == bytes32(0) || detailsHash == bytes32(0)) {
            revert InvalidHash();
        }
        if (amount == 0) revert InvalidAmount();
        if (settlements[settlementId].status != Status.None) revert SettlementAlreadyExists();

        settlements[settlementId] = SettlementRecord({
            invoiceReferenceHash: invoiceReferenceHash,
            detailsHash: detailsHash,
            amount: amount,
            sourceCurrency: sourceCurrency,
            destinationCurrency: destinationCurrency,
            status: Status.Pending,
            recordedBy: msg.sender,
            createdAt: uint64(block.timestamp)
        });

        emit SettlementRecorded(
            settlementId,
            invoiceReferenceHash,
            amount,
            sourceCurrency,
            destinationCurrency,
            msg.sender
        );
    }

    function confirmSettlement(bytes32 settlementId) external onlyOperator {
        SettlementRecord storage record = settlements[settlementId];
        if (record.status != Status.Pending) revert SettlementNotPending();
        record.status = Status.Confirmed;
        emit SettlementStatusUpdated(settlementId, Status.Confirmed, msg.sender);
    }

    function cancelSettlement(bytes32 settlementId) external onlyOperator {
        SettlementRecord storage record = settlements[settlementId];
        if (record.status != Status.Pending) revert SettlementNotPending();
        record.status = Status.Cancelled;
        emit SettlementStatusUpdated(settlementId, Status.Cancelled, msg.sender);
    }
}
