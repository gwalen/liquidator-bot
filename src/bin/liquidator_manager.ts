import { Liquidator } from './liquidator';
import { Commitment } from '@solana/web3.js';

// Configuration parameters can be brought from environment variables or hardcoded for testing
const RPC_URL = process.env.RPC_URL || "https://api.mainnet-beta.solana.com";
const LIQUIDATOR_MARGIN_ACCOUNT = process.env.LIQUIDATOR_MARGIN_ACCOUNT || "YourMarginAccountAddressHere";
const PRIVATE_KEY = process.env.PRIVATE_KEY || "YourPrivateKeyHere";
const INTERVAL = process.env.INTERVAL || "1000"; // Default interval set to 1000 milliseconds
const BURST = parseInt(process.env.BURST || "1");

const COMMITMENT: Commitment = 'confirmed';

async function startLiquidationProcess() {
  try {
    const liquidator = new Liquidator(
        RPC_URL,
        LIQUIDATOR_MARGIN_ACCOUNT,
        PRIVATE_KEY,
        INTERVAL,
        BURST,
        COMMITMENT
    );

    console.log("Liquidator is initialized and starting...");
    await liquidator.runLiquidate();
    console.log("Liquidation process has started successfully.");
  } catch (error) {
    console.error("Failed to start liquidation process:", error);
  }
}

// Start the process
startLiquidationProcess();