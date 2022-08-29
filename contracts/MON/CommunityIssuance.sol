// SPDX-License-Identifier: MIT

pragma solidity ^0.8.14;

import "@openzeppelin/contracts-upgradeable/utils/math/SafeMathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import "../Interfaces/IStabilityPoolManager.sol";
import "../Interfaces/ICommunityIssuance.sol";
import "../Dependencies/BaseMath.sol";
import "../Dependencies/DfrancMath.sol";
import "../Dependencies/CheckContract.sol";

contract CommunityIssuance is ICommunityIssuance, OwnableUpgradeable, CheckContract, BaseMath {
	using SafeMathUpgradeable for uint256;
	using SafeERC20Upgradeable for IERC20Upgradeable;

	string public constant NAME = "CommunityIssuance";
	uint256 public constant DISTRIBUTION_DURATION = 7 days / 60;
	uint256 public constant SECONDS_IN_ONE_MINUTE = 60;

	/* The issuance factor F determines the curvature of the issuance curve.
	 *
	 * Minutes in one year: 60*24*365 = 525600
	 *
	 * For 50% of remaining tokens issued each year, with minutes as time units, we have:
	 *
	 * F ** 525600 = 0.5
	 *
	 * Re-arranging:
	 *
	 * 525600 * ln(F) = ln(0.5)
	 * F = 0.5 ** (1/525600)
	 * F = 0.999998681227695000
	 */
	uint256 public constant ISSUANCE_FACTOR = 999998681227695000;

	IERC20Upgradeable public monToken;
	IStabilityPoolManager public stabilityPoolManager;

	mapping(address => uint256) public totalMONIssued;
	mapping(address => uint256) public totalMONAssigned;
	mapping(address => uint256) public initializedTime;

	address public adminContract;

	bool public isInitialized;

	modifier activeStabilityPoolOnly(address _pool) {
		require(initializedTime[_pool] != 0, "CommunityIssuance: Pool needs to be added first.");
		_;
	}

	modifier isController() {
		require(msg.sender == owner() || msg.sender == adminContract, "Invalid Permission");
		_;
	}

	modifier isStabilityPool(address _pool) {
		require(
			stabilityPoolManager.isStabilityPool(_pool),
			"CommunityIssuance: caller is not SP"
		);
		_;
	}

	modifier onlyStabilityPool() {
		require(
			stabilityPoolManager.isStabilityPool(msg.sender),
			"CommunityIssuance: caller is not SP"
		);
		_;
	}

	// --- Functions ---
	function setAddresses(
		address _monTokenAddress,
		address _stabilityPoolManagerAddress,
		address _adminContract
	) external override initializer {
		require(!isInitialized, "Already initialized");
		checkContract(_monTokenAddress);
		checkContract(_stabilityPoolManagerAddress);
		checkContract(_adminContract);
		isInitialized = true;
		__Ownable_init();

		adminContract = _adminContract;

		monToken = IERC20Upgradeable(_monTokenAddress);
		stabilityPoolManager = IStabilityPoolManager(_stabilityPoolManagerAddress);

		emit MONTokenAddressSet(_monTokenAddress);
		emit StabilityPoolAddressSet(_stabilityPoolManagerAddress);
	}

	function setAdminContract(address _admin) external onlyOwner {
		require(_admin != address(0));
		adminContract = _admin;
	}

	function initializeStabilityPool(address _pool, uint256 _assignedSupply)
		external
		override
		isController
	{
		_initializeStabilityPool(_pool, _assignedSupply, msg.sender);
	}

	function initializeStabilityPoolFrom(
		address _pool,
		uint256 _assignedSupply,
		address _spender
	) external override isController {
		_initializeStabilityPool(_pool, _assignedSupply, _spender);
	}

	function _initializeStabilityPool(
		address _pool,
		uint256 _assignedSupply,
		address _spender
	) internal {
		require(
			stabilityPoolManager.isStabilityPool(_pool),
			"CommunityIssuance: Invalid Stability Pool"
		);

		require(initializedTime[_pool] == 0, "Stability Pool already initialized");

		initializedTime[_pool] = block.timestamp;
		totalMONAssigned[_pool] = _assignedSupply;

		monToken.safeTransferFrom(_spender, address(this), _assignedSupply);
	}

	function issueMON() external override onlyStabilityPool returns (uint256) {
		return _issueMON(msg.sender);
	}

	function _issueMON(address _pool) internal isStabilityPool(_pool) returns (uint256) {
		uint256 latestTotalMONIssued = totalMONAssigned[_pool]
			.mul(_getCumulativeIssuanceFraction(_pool))
			.div(DECIMAL_PRECISION);
		uint256 issuance = latestTotalMONIssued.sub(totalMONIssued[_pool]);

		totalMONIssued[_pool] = latestTotalMONIssued;
		emit TotalMONIssuedUpdated(_pool, latestTotalMONIssued);

		return issuance;
	}

	/* Gets 1-f^t    where: f < 1
    f: issuance factor that determines the shape of the curve
    t:  time passed since last LQTY issuance event  */
	function _getCumulativeIssuanceFraction(address _pool) internal view returns (uint256) {
		// Get the time passed since deployment
		uint256 timePassedInMinutes = block.timestamp.sub(initializedTime[_pool]).div(
			SECONDS_IN_ONE_MINUTE
		);

		// f^t
		uint256 power = DfrancMath._decPow(ISSUANCE_FACTOR, timePassedInMinutes);

		//  (1 - f^t)
		uint256 cumulativeIssuanceFraction = (uint256(DECIMAL_PRECISION).sub(power));
		assert(cumulativeIssuanceFraction <= DECIMAL_PRECISION); // must be in range [0,1]

		return cumulativeIssuanceFraction;
	}

	function sendMON(address _account, uint256 _MONamount) external override onlyStabilityPool {
		uint256 balanceMON = monToken.balanceOf(address(this));
		uint256 safeAmount = balanceMON >= _MONamount ? _MONamount : balanceMON;

		if (safeAmount == 0) {
			return;
		}

		monToken.transfer(_account, safeAmount);
	}
}
