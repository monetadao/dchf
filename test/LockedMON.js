const { expect } = require("hardhat");


describe("Locked MON", function () {

    let MONToken;
    let LockedMON;

    beforeEach(async function () {
        [Owner, Account1, Account2] = await ethers.getSigners();

        const MONTokenFactory = await ethers.getContractFactory("MONToken");
        MONToken = await MONTokenFactory.deploy(Owner.address);

        const LockedMONFactory = await ethers.getContractFactory("LockedMON");
        LockedMON = await LockedMONFactory.deploy();
        await LockedMON.setAddresses(MONToken.address);
    });

    describe("Add vesting", function () {
        it("Can add a vesting address", async function () {
            const vestingAddress = Account1.address;
            const vestingAmount = 1000;

            await MONToken.approve(LockedMON.address, vestingAmount);

            await LockedMON.addEntityVesting(vestingAddress, vestingAmount);

            const rule = await LockedMON.entitiesVesting(vestingAddress);

            const blockNumBefore = await ethers.provider.getBlockNumber();
            const blockBefore = await ethers.provider.getBlock(blockNumBefore);
            const timestampBefore = blockBefore.timestamp;

            expect(rule.totalSupply.toNumber()).to.equal(vestingAmount);
            expect(rule.startVestingDate.toNumber()).to.equal(timestampBefore + 31_536_000);
            expect(rule.endVestingDate.toNumber()).to.equal(timestampBefore + 63_072_000);
            expect(rule.claimed.toNumber()).to.equal(0);

        });

        it("Can add a vesting addresses batch", async function () {
            const vestingAddress1 = Account1.address;
            const vestingAddress2 = Account2.address;

            const vestingAmount1 = 1000;
            const vestingAmount2 = 2000;

            await MONToken.approve(LockedMON.address, vestingAmount1 + vestingAmount2);

            await LockedMON.addEntityVestingBatch([vestingAddress1, vestingAddress2], [vestingAmount1, vestingAmount2]);

            const rule1 = await LockedMON.entitiesVesting(vestingAddress1);
            const rule2 = await LockedMON.entitiesVesting(vestingAddress2);

            const blockNumBefore = await ethers.provider.getBlockNumber();
            const blockBefore = await ethers.provider.getBlock(blockNumBefore);
            const timestampBefore = blockBefore.timestamp;

            expect(rule1.totalSupply.toNumber()).to.equal(vestingAmount1);
            expect(rule1.startVestingDate.toNumber()).to.equal(timestampBefore + 31_536_000);
            expect(rule1.endVestingDate.toNumber()).to.equal(timestampBefore + 63_072_000);
            expect(rule1.claimed.toNumber()).to.equal(0);

            expect(rule2.totalSupply.toNumber()).to.equal(vestingAmount2);
            expect(rule2.startVestingDate.toNumber()).to.equal(timestampBefore + 31_536_000);
            expect(rule2.endVestingDate.toNumber()).to.equal(timestampBefore + 63_072_000);
            expect(rule2.claimed.toNumber()).to.equal(0);

        });
    });

    describe("claimable amount", function () {
        it("can get zero claimable amount", async function () {
            const claimableAmount = await LockedMON.getClaimableMON(Owner.address);
            expect(claimableAmount.toNumber()).to.equal(0)
        });
        it("can get claimable amount", async function () {
            const vestingAddress = Account1.address;
            const vestingAmount = 100000;

            await MONToken.approve(LockedMON.address, vestingAmount);

            await LockedMON.addEntityVesting(vestingAddress, vestingAmount);

            await network.provider.send("evm_increaseTime", [31_536_000])
            await network.provider.send("evm_mine")

            const claimableAmount = await LockedMON.getClaimableMON(vestingAddress);

            expect(claimableAmount.toNumber()).to.equal(0)

            await network.provider.send("evm_increaseTime", [7_884_000])
            await network.provider.send("evm_mine")

            const claimableAmount2 = await LockedMON.getClaimableMON(vestingAddress);

            expect(claimableAmount2.toNumber()).to.equal(25000)

            await network.provider.send("evm_increaseTime", [15_768_000])
            await network.provider.send("evm_mine")

            const claimableAmount3 = await LockedMON.getClaimableMON(vestingAddress);

            expect(claimableAmount3.toNumber()).to.equal(75000)

            await network.provider.send("evm_increaseTime", [7_884_000])
            await network.provider.send("evm_mine")

            const claimableAmount4 = await LockedMON.getClaimableMON(vestingAddress);

            expect(claimableAmount4.toNumber()).to.equal(100000)

            await network.provider.send("evm_increaseTime", [7_884_000])
            await network.provider.send("evm_mine")

            const claimableAmount5 = await LockedMON.getClaimableMON(vestingAddress);

            expect(claimableAmount5.toNumber()).to.equal(100000)
        });
        it("can claim amoun", async function () {
            const vestingAddress = Account1.address;
            const vestingAmount = 100000;

            await MONToken.approve(LockedMON.address, vestingAmount);

            await LockedMON.addEntityVesting(vestingAddress, vestingAmount);

            await network.provider.send("evm_increaseTime", [31_536_000])
            await network.provider.send("evm_mine")

            await LockedMON.connect(Account1).claimMONToken();

            const balance = await MONToken.balanceOf(vestingAddress);

            expect(balance.toNumber()).to.equal(0)

            await network.provider.send("evm_increaseTime", [7_884_000])
            await network.provider.send("evm_mine")

            await LockedMON.connect(Account1).claimMONToken();

            const balance2 = await MONToken.balanceOf(vestingAddress);

            expect(balance2.toNumber()).to.equal(25000)

            await network.provider.send("evm_increaseTime", [15_768_000])
            await network.provider.send("evm_mine")

            await LockedMON.connect(Account1).claimMONToken();

            const balance3 = await MONToken.balanceOf(vestingAddress);

            expect(balance3.toNumber()).to.equal(75000)

            await network.provider.send("evm_increaseTime", [15_768_000])
            await network.provider.send("evm_mine")

            await LockedMON.connect(Account1).claimMONToken();

            const balance4 = await MONToken.balanceOf(vestingAddress);

            expect(balance4.toNumber()).to.equal(100000)
        });
    });

    describe("Lower and remove vesting", function () {
        it("can lower vesting", async function () {
            const vestingAddress = Account1.address;
            const vestingAmount = 100000;
            const lowerAmount = 75000;

            await MONToken.approve(LockedMON.address, vestingAmount);

            await LockedMON.addEntityVesting(vestingAddress, vestingAmount);

            await network.provider.send("evm_increaseTime", [47_304_000])
            await network.provider.send("evm_mine")

            await LockedMON.lowerEntityVesting(vestingAddress, lowerAmount);

            const balance = await MONToken.balanceOf(vestingAddress);

            expect(balance.toNumber()).to.equal(50000)

            await network.provider.send("evm_increaseTime", [7_884_000])
            await network.provider.send("evm_mine")

            const claimableAmount = await LockedMON.getClaimableMON(vestingAddress);

            expect(claimableAmount.toNumber()).to.equal(6250)

            await network.provider.send("evm_increaseTime", [7_884_000])
            await network.provider.send("evm_mine")

            const claimableAmount2 = await LockedMON.getClaimableMON(vestingAddress);

            expect(claimableAmount2.toNumber()).to.equal(25000)
        });

        it("can lower vesting before start", async function () {
            const vestingAddress = Account1.address;
            const vestingAmount = 100000;
            const lowerAmount = 75000;

            await MONToken.approve(LockedMON.address, vestingAmount);

            await LockedMON.addEntityVesting(vestingAddress, vestingAmount);

            await network.provider.send("evm_increaseTime", [15_768_000])
            await network.provider.send("evm_mine")

            await LockedMON.lowerEntityVesting(vestingAddress, lowerAmount);

            const balance = await MONToken.balanceOf(vestingAddress);

            expect(balance.toNumber()).to.equal(0)

            await network.provider.send("evm_increaseTime", [31_536_000])
            await network.provider.send("evm_mine")

            const claimableAmount2 = await LockedMON.getClaimableMON(vestingAddress);

            expect(claimableAmount2.toNumber()).to.equal(37500)

            await network.provider.send("evm_increaseTime", [31_536_000])
            await network.provider.send("evm_mine")

            const claimableAmount3 = await LockedMON.getClaimableMON(vestingAddress);

            expect(claimableAmount3.toNumber()).to.equal(75000)
        });

        it("can remove vesting", async function () {
            const vestingAddress = Account1.address;
            const vestingAmount = 100000;

            await MONToken.approve(LockedMON.address, vestingAmount);

            await LockedMON.addEntityVesting(vestingAddress, vestingAmount);

            await network.provider.send("evm_increaseTime", [47_304_000])
            await network.provider.send("evm_mine")

            await LockedMON.removeEntityVesting(vestingAddress);

            const balance = await MONToken.balanceOf(vestingAddress);

            expect(balance.toNumber()).to.equal(50000)

            await network.provider.send("evm_increaseTime", [7_884_000])
            await network.provider.send("evm_mine")

            const claimableAmount = await LockedMON.getClaimableMON(vestingAddress);

            expect(claimableAmount.toNumber()).to.equal(0)

            const unassigned = await LockedMON.getUnassignMONTokensAmount();

            expect(unassigned.toNumber()).to.equal(50000)

            const balanceOwnerBefore = await MONToken.balanceOf(Owner.address);

            await LockedMON.transferUnassignedMON();

            const balanceOwnerAfter = await MONToken.balanceOf(Owner.address);

            expect(balanceOwnerAfter.sub(balanceOwnerBefore).toNumber()).to.equal(50000)
        });
    });

});