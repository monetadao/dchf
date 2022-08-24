-> Notes for the Auditor:

1. Currently the private keys / api keys for deployment are hard-coded in the "hardhat.config.js" file (don't use the git.secrets.js file).

2. In mainnetDeployment/deploymentParams.rinkeby.js it's needed to replace the values between the lines 25-27 to the Deployer's wallet (accordingly to the private key set on hardhat.config.js file). All the oracles addresses are correct and should not be changed. Also the value in line 96 (GAS_PRICE) is set correctly and you risk getting stuck in the deployment if the value is changed.

3. The contract DfrancParameters.sol contains all the parameters from the system and should not be modified. However, the system is set to block redemptions in it's first 14 days. For testing purposes, it's recommended to change it for a lower value. You can find it on the line 15.

4. Even though the minimum collateral ratio is 110%, whenever the TCR (total system collateralization ratio - per collateral) falls below 150% it enters in recovery mode. 

Recovery Mode kicks in when the total collateralization ratio (TCR) of the system falls below 150%.

During Recovery Mode, liquidation conditions are relaxed, and the system blocks borrower transactions that would further decrease the TCR. New DCHF may only be issued by adjusting existing Troves in a way that improves their ICR, or by opening a new Trove with an ICR of >=150%. In general, if an existing Trove's adjustment reduces its ICR, the transaction is only executed if the resulting TCR is above 150%.

5. For testnet (Rinkeby) tests purposes, two mock-ERC20 contracts are generated in order to have plenty amount of ETH / BTC issued to the deployer. You need to approve the correct amounts to be able to interact with the system, by calling their "approve" function and setting as spender the address of the Borrower Operations contract. 

Please note that in this case, BTC uses 8 decimals and ETH uses 18. This is the only case where you'll have different decimals (mock ERC-20 contracts), as the system converts everything to 18 decimals in it's architecture.

6. When opening a Trove (openTrove - BorrowerOperations.sol) without having a Hint (HintHelpers.sol), you should provide for both "_lowerHint" and "_upperHint" parameters a zero address value.

7. In many functions that you may call, the parameter "_price" is needed. You can get it by calling the function "fetchPrice" in the PriceFeedV2.sol contract (PriceFeed). Do not use PriceFeedOld (it won't be deployed by default). You may call this function using seth or ethers.js, which will return the updated ETH / CHF or BTC / CHF price, accordingly to the Oracle's lastGoodPrice / lastGoodIndex.

Below there is a list of the Public user-facing functions, that should be tested more in-depth, including flaws in access control:

Borrower (Trove) Operations - BorrowerOperations.sol

openTrove(uint _maxFeePercentage, uint _DCHFAmount, address _upperHint, address _lowerHint): payable function that creates a Trove for the caller with the requested debt, and the Ether received as collateral. Successful execution is conditional mainly on the resulting collateralization ratio which must exceed the minimum (110% in Normal Mode, 150% in Recovery Mode). In addition to the requested debt, extra debt is issued to pay the issuance fee, and cover the gas compensation. The borrower has to provide a _maxFeePercentage that he/she is willing to accept in case of a fee slippage, i.e. when a redemption transaction is processed first, driving up the issuance fee.

addColl(address _upperHint, address _lowerHint)): payable function that adds the received Ether to the caller's active Trove.

withdrawColl(uint _amount, address _upperHint, address _lowerHint): withdraws _amount of collateral from the caller’s Trove. Executes only if the user has an active Trove, the withdrawal would not pull the user’s Trove below the minimum collateralization ratio, and the resulting total collateralization ratio of the system is above 150%.

function withdrawDCHF(uint _maxFeePercentage, uint _DCHFAmount, address _upperHint, address _lowerHint): issues _amount of DCHF from the caller’s Trove to the caller. Executes only if the Trove's collateralization ratio would remain above the minimum, and the resulting total collateralization ratio is above 150%. The borrower has to provide a _maxFeePercentage that he/she is willing to accept in case of a fee slippage, i.e. when a redemption transaction is processed first, driving up the issuance fee.

repayDCHF(uint _amount, address _upperHint, address _lowerHint): repay _amount of DCHF to the caller’s Trove, subject to leaving 50 debt in the Trove (which corresponds to the 50 DCHF gas compensation).

_adjustTrove(address _borrower, uint _collWithdrawal, uint _debtChange, bool _isDebtIncrease, address _upperHint, address _lowerHint, uint _maxFeePercentage): enables a borrower to simultaneously change both their collateral and debt, subject to all the restrictions that apply to individual increases/decreases of each quantity with the following particularity: if the adjustment reduces the collateralization ratio of the Trove, the function only executes if the resulting total collateralization ratio is above 150%. The borrower has to provide a _maxFeePercentage that he/she is willing to accept in case of a fee slippage, i.e. when a redemption transaction is processed first, driving up the issuance fee. The parameter is ignored if the debt is not increased with the transaction.

closeTrove(): allows a borrower to repay all debt, withdraw all their collateral, and close their Trove. Requires the borrower have a DCHF balance sufficient to repay their trove's debt, excluding gas compensation - i.e. (debt - 50) DCHF.

claimCollateral(address _user): when a borrower’s Trove has been fully redeemed from and closed, or liquidated in Recovery Mode with a collateralization ratio above 110%, this function allows the borrower to claim their ETH collateral surplus that remains in the system (collateral - debt upon redemption; collateral - 110% of the debt upon liquidation).


TroveManager and TroveManagerHelpers Functions - TroveManager.sol and TroveManagerHelpers.sol

liquidate(address _borrower): callable by anyone, attempts to liquidate the Trove of _user. Executes successfully if _user’s Trove meets the conditions for liquidation (e.g. in Normal Mode, it liquidates if the Trove's ICR < the system MCR).

liquidateTroves(uint n): callable by anyone, checks for under-collateralized Troves below MCR and liquidates up to n, starting from the Trove with the lowest collateralization ratio; subject to gas constraints and the actual number of under-collateralized Troves. The gas costs of liquidateTroves(uint n) mainly depend on the number of Troves that are liquidated, and whether the Troves are offset against the Stability Pool or redistributed. For n=1, the gas costs per liquidated Trove are roughly between 215K-400K, for n=5 between 80K-115K, for n=10 between 70K-82K, and for n=50 between 60K-65K.

batchLiquidateTroves(address[] calldata _troveArray): callable by anyone, accepts a custom list of Troves addresses as an argument. Steps through the provided list and attempts to liquidate every Trove, until it reaches the end or it runs out of gas. A Trove is liquidated only if it meets the conditions for liquidation. For a batch of 10 Troves, the gas costs per liquidated Trove are roughly between 75K-83K, for a batch of 50 Troves between 54K-69K.

redeemCollateral(uint _DCHFAmount, address _firstRedemptionHint, address _upperPartialRedemptionHint, address _lowerPartialRedemptionHint, uint _partialRedemptionHintNICR, uint _maxIterations, uint _maxFeePercentage): redeems _DCHFamount of stablecoins for ether from the system. Decreases the caller’s DCHF balance, and sends them the corresponding amount of ETH. Executes successfully if the caller has sufficient DCHF to redeem. The number of Troves redeemed from is capped by _maxIterations. The borrower has to provide a _maxFeePercentage that he/she is willing to accept in case of a fee slippage, i.e. when another redemption transaction is processed first, driving up the redemption fee.

getCurrentICR(address _user, uint _price): computes the user’s individual collateralization ratio (ICR) based on their total collateral and total DCHF debt. Returns 2^256 -1 if they have 0 debt.

getTroveOwnersCount(): get the number of active Troves in the system.

getPendingETHReward(address _borrower): get the pending ETH reward from liquidation redistribution events, for the given Trove.

getPendingDCHFDebtReward(address _borrower): get the pending Trove debt "reward" (i.e. the amount of extra debt assigned to the Trove) from liquidation redistribution events.

getEntireDebtAndColl(address _borrower): returns a Trove’s entire debt and collateral, which respectively include any pending debt rewards and ETH rewards from prior redistributions.

getEntireSystemColl(): Returns the systemic entire collateral allocated to Troves, i.e. the sum of the ETH in the Active Pool and the Default Pool.

getEntireSystemDebt() Returns the systemic entire debt assigned to Troves, i.e. the sum of the DCHFDebt in the Active Pool and the Default Pool.

getTCR(): returns the total collateralization ratio (TCR) of the system. The TCR is based on the the entire system debt and collateral (including pending rewards).

checkRecoveryMode(): reveals whether or not the system is in Recovery Mode (i.e. whether the Total Collateralization Ratio (TCR) is below the Critical Collateralization Ratio (CCR)).
Hint Helper Functions - HintHelpers.sol

function getApproxHint(uint _CR, uint _numTrials, uint _inputRandomSeed): helper function, returns a positional hint for the sorted list. Used for transactions that must efficiently re-insert a Trove to the sorted list.

getRedemptionHints(uint _DCHFamount, uint _price, uint _maxIterations): helper function specifically for redemptions. Returns three hints:

    firstRedemptionHint is a positional hint for the first redeemable Trove (i.e. Trove with the lowest ICR >= MCR).
    partialRedemptionHintNICR is the final nominal ICR of the last Trove after being hit by partial redemption, or zero in case of no partial redemption (see Hints for redeemCollateral).
    truncatedDCHFamount is the maximum amount that can be redeemed out of the the provided _DCHFamount. This can be lower than _DCHFamount when redeeming the full amount would leave the last Trove of the redemption sequence with less debt than the minimum allowed value.

The number of Troves to consider for redemption can be capped by passing a non-zero value as _maxIterations, while passing zero will leave it uncapped.


Stability Pool Functions - StabilityPool.sol

provideToSP(uint _amount, address _frontEndTag): allows stablecoin holders to deposit _amount of DCHF to the Stability Pool. It sends _amount of DCHF from their address to the Pool, and tops up their DCHF deposit by _amount and their tagged front end’s stake by _amount. If the depositor already has a non-zero deposit, it sends their accumulated ETH and MON gains to their address, and pays out their front end’s MON gain to their front end.

withdrawFromSP(uint _amount): allows a stablecoin holder to withdraw _amount of DCHF from the Stability Pool, up to the value of their remaining Stability deposit. It decreases their DCHF balance by _amount and decreases their front end’s stake by _amount. It sends the depositor’s accumulated ETH and MON gains to their address, and pays out their front end’s MON gain to their front end. If the user makes a partial withdrawal, their deposit remainder will earn further gains. To prevent potential loss evasion by depositors, withdrawals from the Stability Pool are suspended when there are liquidable Troves with ICR < 110% in the system.

withdrawETHGainToTrove(address _hint): sends the user's entire accumulated ETH gain to the user's active Trove, and updates their Stability deposit with its accumulated loss from debt absorptions. Sends the depositor's MON gain to the depositor, and sends the tagged front end's MON gain to the front end.

registerFrontEnd(uint _kickbackRate): Registers an address as a front end and sets their chosen kickback rate in range [0,1].

getDepositorETHGain(address _depositor): returns the accumulated ETH gain for a given Stability Pool depositor

getDepositorMONGain(address _depositor): returns the accumulated MON gain for a given Stability Pool depositor

getFrontEndMONGain(address _frontEnd): returns the accumulated MON gain for a given front end

getCompoundedDCHFDeposit(address _depositor): returns the remaining deposit amount for a given Stability Pool depositor

getCompoundedFrontEndStake(address _frontEnd): returns the remaining front end stake for a given front end


MON Staking Functions MONStaking.sol

stake(uint _MONamount): sends _MONAmount from the caller to the staking contract, and increases their stake. If the caller already has a non-zero stake, it pays out their accumulated ETH and DCHF gains from staking.

unstake(uint _MONamount): reduces the caller’s stake by _MONamount, up to a maximum of their entire stake. It pays out their accumulated ETH and DCHF gains from staking.
Lockup Contract Factory LockupContractFactory.sol

deployLockupContract(address _beneficiary, uint _unlockTime); Deploys a LockupContract, and sets the beneficiary’s address, and the _unlockTime - the instant in time at which the MON can be withrawn by the beneficiary.
Lockup contract - LockupContract.sol

withdrawMON(): When the current time is later than the unlockTime and the caller is the beneficiary, it transfers their MON to them.


DCHF token DCHFToken.sol and MON token MONToken.sol

Standard ERC20 and EIP2612 (permit() ) functionality.

Note: permit() can be front-run, as it does not require that the permitted spender be the msg.sender.

This allows flexibility, as it means that anyone can submit a Permit signed by A that allows B to spend a portion of A's tokens.

The end result is the same for the signer A and spender B, but does mean that a permit transaction could be front-run and revert - which may hamper the execution flow of a contract that is intended to handle the submission of a Permit on-chain.

For more details please see the original proposal EIP-2612: https://eips.ethereum.org/EIPS/eip-2612