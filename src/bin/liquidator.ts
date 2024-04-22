/* eslint-disable no-constant-condition */
import {
    ProgramAccount,
    Market,
    ParclV3Sdk,
    getExchangePda,
    getMarketPda,
    MarginAccountWrapper,
    MarketWrapper,
    // ExchangeWrapper,
    // LiquidateAccounts,
    // LiquidateParams,
    MarketMap,
    PriceFeedMap,
    Address,
    translateAddress,
    Exchange,
    ExchangeWrapper,
} from "@parcl-oss/v3-sdk";
import {
    Commitment,
    Connection,
    Keypair,
    PublicKey,
} from "@solana/web3.js";
import bs58 from "bs58";
import * as dotenv from "dotenv";
import { sendSignedTransactionWithRepeat } from "./send_with_repeat";
dotenv.config();

export class Liquidator {
    private sdk: ParclV3Sdk;
    private connection: Connection;
    private interval: number; // interval in milliseconds
    private exchangeAddress: Address;
    private liquidatorSigner: Keypair;
    private liquidatorMarginAccount: Address;

    constructor(
        rpcUrl: string,
        liquidatorMarginAccount: string,
        privateKey: string,
        interval: string = "1000",
        commitment: Commitment | undefined = undefined
    ) {
        const [exchangeAddress] = getExchangePda(0); // there is just one: usdc
        this.exchangeAddress = exchangeAddress;
        this.liquidatorMarginAccount = translateAddress(liquidatorMarginAccount);
        this.liquidatorSigner = Keypair.fromSecretKey(bs58.decode(privateKey));
        this.interval = parseInt(interval);
        this.sdk = new ParclV3Sdk(
            { 
                rpcUrl,
                commitment,
                confirmOptions: {
                    skipPreflight: true // skip preflight check to be faster
                }
            });
        this.connection = new Connection(rpcUrl, commitment);
        // console.log("connection: ", this.connection);
        }

    public async runLiquidate(): Promise<void> {
        console.log("Starting liquidator");

        try {
            await this.run();
        } catch (error) {
            console.error("Liquidator run() loop error: ", error);
        }
    }

    private async run(): Promise<void> {
        let firstRun = true;
        while (true) {
            if (firstRun) {
                firstRun = false;
            } else { 
                await this.sleep(this.interval);
            }
            
            try {
                await this.processLiquidationCycle();
            } catch (error) {
                console.error("Error during liquidation cycle:", error);
                // Continue processing but ensure the error is logged
            }
        }
    }

    private async processLiquidationCycle(): Promise<void> {
        const exchange = await this.fetchExchange();
        const allMarketAddresses: PublicKey[] = exchange.marketIds.filter(id => id !== 0)
            .map(marketId => getMarketPda(this.exchangeAddress, marketId)[0]);
        console.log("Fetch markets");    
        const allMarkets = await this.sdk.accountFetcher.getMarkets(allMarketAddresses);
        console.log("All markets count: ", allMarkets.length);    
        const [markets, priceFeeds] = await this.getMarketMapAndPriceFeedMap(allMarkets);

        console.log("Fetch all margin accounts");
        const allMarginAccounts = await this.fetchAllMarginAccounts();
        console.log("All margin accounts count: ", allMarginAccounts.length);
        const exchangeWrapper = new ExchangeWrapper(exchange);

        // Process each margin account
        console.log("Process margin accounts");
         // Create an array of promises for each liquidation attempt
        const liquidationPromises = allMarginAccounts.map(marginAccount =>
            this.attemptLiquidation(exchangeWrapper, marginAccount, markets, priceFeeds)
        );

        // Use Promise.all to wait for all liquidation attempts to complete
        await Promise.all(liquidationPromises);
    }

    private async attemptLiquidation(
        exchangeWrapper: ExchangeWrapper,
        marginAccount: MarginAccountWrapper,
        markets: MarketMap, priceFeeds: PriceFeedMap
    ): Promise<void> {
        if (marginAccount.inLiquidation()) {
            console.log(`Liquidating account already in liquidation (${marginAccount.address})`);
            await this.liquidate(marginAccount, markets);
        } else if (marginAccount.getAccountMargins(exchangeWrapper, markets, priceFeeds, Math.floor(Date.now() / 1000)).canLiquidate()) {
            console.log(`Starting liquidation for ${marginAccount.address}`);
            const signature = await this.liquidate(marginAccount, markets);
            console.log("Signature: ", signature);
        }
    }

    private async liquidate(marginAccountWrapper: MarginAccountWrapper, markets: MarketMap): Promise<string> {
        const [marketAddresses, priceFeedAddresses] = this.getMarketsAndPriceFeeds(marginAccountWrapper, markets);

        if (marginAccountWrapper.address === undefined) {
            throw new Error("Attempted to liquidate a margin account with an undefined address");
        }

        try {
            const { blockhash: recentBlockhash } = await this.connection.getLatestBlockhash();
            const tx = this.sdk.transactionBuilder()
                .liquidate(
                    {
                        marginAccount: marginAccountWrapper.address,
                        exchange: marginAccountWrapper.marginAccount.exchange,
                        owner: marginAccountWrapper.marginAccount.owner,
                        liquidator: this.liquidatorSigner.publicKey,
                        liquidatorMarginAccount: this.liquidatorMarginAccount,
                    },
                    marketAddresses,
                    priceFeedAddresses
                )
                .feePayer(this.liquidatorSigner.publicKey)
                .buildSigned([this.liquidatorSigner], recentBlockhash);

            return await sendSignedTransactionWithRepeat(
                tx,
                this.connection,
            );    

            // return await sendAndConfirmTransaction(this.connection, tx, [this.liquidatorSigner]);
        } catch (error) {
            // we throw here but all errors are catched in runLiquidate()
            throw new Error(`Error while during liquidation for margin account: ${marginAccountWrapper.address}, error,: ${error}`);
        }
    }

    // data fetchers

    private async getMarketMapAndPriceFeedMap(allMarkets: (ProgramAccount<Market> | undefined)[]): Promise<[MarketMap, PriceFeedMap]> {
        const markets: MarketMap = {};

        for (const market of allMarkets) {
            if (market) {   // Make sure market is not undefined
                markets[market.account.id] = new MarketWrapper(market.account, market.address);
            }
        }
        const allPriceFeedAddresses = (allMarkets as ProgramAccount<Market>[]).map(
            (market) => market.account.priceFeed
        );

        const allPriceFeeds = await this.sdk.accountFetcher.getPythPriceFeeds(allPriceFeedAddresses);
        const priceFeeds: PriceFeedMap = {};

        for (let i = 0; i < allPriceFeeds.length; i++) {
            const priceFeed = allPriceFeeds[i];
            if (priceFeed) {
                priceFeeds[allPriceFeedAddresses[i]] = priceFeed;
            }
        }

        return [markets, priceFeeds];
    }

    private async fetchExchange(): Promise<Exchange> {
        const exchange = await this.sdk.accountFetcher.getExchange(this.exchangeAddress);
        if (!exchange) throw new Error("Invalid exchange address.");
        return exchange;
    }

    private async fetchAllMarginAccounts(): Promise<MarginAccountWrapper[]> {
        const allMarginAccounts = await this.sdk.accountFetcher.getAllMarginAccounts();
        return allMarginAccounts.map(raw => new MarginAccountWrapper(raw.account, raw.address));
    }

    // helpers

    private async sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private getMarketsAndPriceFeeds(marginAccount: MarginAccountWrapper, markets: MarketMap): [Address[], Address[]] {
        const marketAddresses: Address[] = [];
        const priceFeedAddresses: Address[] = [];

        for (const position of marginAccount.positions()) {
            const market = markets[position.marketId()];
            if (!market) {
                throw new Error(`Market is missing from markets map (id=${position.marketId()})`);
            }
            const marketAddress = market.address;
            if(marketAddress) {
                marketAddresses.push(marketAddress);
                priceFeedAddresses.push(market.priceFeed());
            }
        }

        return [marketAddresses, priceFeedAddresses];
    }
}

