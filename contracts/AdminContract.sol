//SPDX-License-Identifier: MIT
pragma solidity ^0.8.14;

import "@openzeppelin/contracts/access/Ownable.sol";

import "./Dependencies/CheckContract.sol";
import "./Dependencies/Initializable.sol";

import "./Interfaces/IStabilityPoolManager.sol";
import "./Interfaces/IDfrancParameters.sol";
import "./Interfaces/IStabilityPool.sol";
import "./Interfaces/ICommunityIssuance.sol";

contract AdminContract is Ownable, Initializable {
	string public constant NAME = "AdminContract";

	bool public isInitialized;

	IDfrancParameters private dfrancParameters;
	IStabilityPoolManager private stabilityPoolManager;
	ICommunityIssuance private communityIssuance;

	function setAddresses(
		address _parameters,
		address _stabilityPoolManager,
		address _communityIssuanceAddress
	) external initializer onlyOwner {
		require(!isInitialized, "Already initialized");
		CheckContract(_parameters);
		CheckContract(_stabilityPoolManager);
		CheckContract(_communityIssuanceAddress);

		isInitialized = true;

		communityIssuance = ICommunityIssuance(_communityIssuanceAddress);

		dfrancParameters = IDfrancParameters(_parameters);

		stabilityPoolManager = IStabilityPoolManager(_stabilityPoolManager);
	}

	// Needs to approve Community Issuance to use this function.
	function addNewCollateral(
		address _stabilityPoolProxyAddress,
		address _assetOracle,
		uint256 assignedToken,
		uint256 _tokenPerWeekDistributed,
		uint256 redemptionLockInDay
	) external onlyOwner {
		address _asset = IStabilityPool(_stabilityPoolProxyAddress).getAssetType();

		require(
			stabilityPoolManager.unsafeGetAssetStabilityPool(_asset) == address(0),
			"This collateral already exists"
		);

		dfrancParameters.priceFeed().addOracle(_asset, _assetOracle);
		dfrancParameters.setAsDefaultWithRemptionBlock(_asset, redemptionLockInDay);

		stabilityPoolManager.addStabilityPool(_asset, _stabilityPoolProxyAddress);
		communityIssuance.addFundToStabilityPoolFrom(
			_stabilityPoolProxyAddress,
			assignedToken,
			msg.sender
		);
		communityIssuance.setWeeklyDfrancDistribution(
			_stabilityPoolProxyAddress,
			_tokenPerWeekDistributed
		);
	}
}
