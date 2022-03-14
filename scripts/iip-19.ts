import { task } from "hardhat/config"
import { BigNumber } from "ethers";
import { AlphaProposalBuilder } from "@idle-finance/hardhat-proposals-plugin/dist/src/proposals/compound-alpha";

const addresses = require("../common/addresses")
const ERC20_ABI = require("../abi/ERC20.json");
const IdleControllerAbi = require("../abi/IdleController.json");
const UnitrollerAbi = require("../abi/Unitroller.json");
const GovernableFundABI = require("../abi/GovernableFund.json");
const GovernorBravoDelegateABI = require("../abi/GovernorBravoDelegate.json");

const toBN = function (v: any): BigNumber { return BigNumber.from(v.toString()) };
const ONE = toBN(1e18);

const iipDescription = "IIP-19: Refund Treasury (IDLE) and update IdleController";

export default task("iip-19", "Refund Treasury (IDLE) and update IdleController")
    .setAction(async (_, hre) => {
        const isLocalNet = hre.network.name == 'hardhat';

        const governorBravoAddress = '0x3D5Fc645320be0A085A32885F078F7121e5E5375';
        const idleControllerNewImpl = '0x2c08baCc1Fc6095F21eb59E57318A6c06D3fCa24'

        let governorBravo = await hre.ethers.getContractAt(GovernorBravoDelegateABI, governorBravoAddress);
        let proposalBuilder = new AlphaProposalBuilder(hre, governorBravo, hre.config.proposals.votingToken);

        const ecosystemFund = await hre.ethers.getContractAt(GovernableFundABI, addresses.ecosystemFund);
        const unitroller = await hre.ethers.getContractAt(UnitrollerAbi, addresses.idleController);
        const idleControllerNew = await hre.ethers.getContractAt(IdleControllerAbi, idleControllerNewImpl);


        const idleToken = await hre.ethers.getContractAt(ERC20_ABI, addresses.IDLE); // idle token    
        const idleAmountToTransfer = toBN(261000).mul(ONE);

        proposalBuilder = proposalBuilder
            .addContractAction(ecosystemFund, "transfer", [addresses.IDLE, addresses.treasuryMultisig, idleAmountToTransfer])
            .addContractAction(unitroller, "_setPendingImplementation", [idleControllerNewImpl])
            .addContractAction(idleControllerNew, "_become", [unitroller.address])

        // Proposal
        proposalBuilder.setDescription(iipDescription);
        const proposal = proposalBuilder.build()
        await proposal.printProposalInfo();

        const treasuryIdleBalanceBefore = await idleToken.balanceOf(addresses.treasuryMultisig);

        await hre.run('execute-proposal-or-simulate', { proposal, isLocalNet });

        // Skip tests in mainnet
        if (!isLocalNet) {
            return;
        }

        console.log("Checking effects...");
        
        // Check that balance is changed
        const treasuryIdleBalanceAfter = await idleToken.balanceOf(addresses.treasuryMultisig);
        const treasuryIdleBalanceIncrease = treasuryIdleBalanceAfter.sub(treasuryIdleBalanceBefore);
        
        // Check that implementation has changed
        const implementationAddress = await unitroller.comptrollerImplementation();

        console.log(`Treasury IDLE balance before: ${hre.ethers.utils.formatEther(treasuryIdleBalanceBefore)}`);
        console.log(`Treasury IDLE balance after: ${hre.ethers.utils.formatEther(treasuryIdleBalanceAfter)} (+ ${hre.ethers.utils.formatEther(treasuryIdleBalanceIncrease)} IDLE)`);
        console.log(`Implementation for IdleController (${unitroller.address}): ${implementationAddress}\n`);

        if (treasuryIdleBalanceIncrease.eq(idleAmountToTransfer)) {
            console.log(`✅ Correct balance increase!`);
        } else {
            console.log('🚨 Incorrect increase in treasury balances!');
        }

        if (implementationAddress == idleControllerNew.address) {
            console.log(`✅ Correct implementation set!`);
        } else {
            console.log('🚨 Incorrect implementation after IIP execution!');
        }
    });