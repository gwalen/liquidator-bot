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
    // Signer,
    sendAndConfirmTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import * as dotenv from "dotenv";
dotenv.config();

export class Liquidator {
    private sdk: ParclV3Sdk;
    private connection: Connection;
    private interval: number;
    private exchangeAddress: Address;
    private liquidatorSigner: Keypair;
    private liquidatorMarginAccount: Address;

    constructor(rpcUrl: string, liquidatorMarginAccount: string, privateKey: string, interval: string = "300", commitment: Commitment | undefined = undefined) {
        const [exchangeAddress] = getExchangePda(0);
        this.exchangeAddress = exchangeAddress;
        this.liquidatorMarginAccount = translateAddress(liquidatorMarginAccount);
        this.liquidatorSigner = Keypair.fromSecretKey(bs58.decode(privateKey));
        this.interval = parseInt(interval);
        this.sdk = new ParclV3Sdk({ rpcUrl, commitment });
        this.connection = new Connection(rpcUrl, commitment);
    }

    public async runLiquidate(): Promise<void> {
        console.log("Starting liquidator");

        try {
            await this.run();
        } catch (error) {
            console.error("Failed to run liquidator due to error:", error);
            // Optional: implement retry logic or other error handling here
        }
    }

    private async run(): Promise<void> {
        let firstRun = true;
        while (true) {
            if (!firstRun) {
                await this.sleep(this.interval * 1000);
            }
            firstRun = false;
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
        const allMarkets = await this.sdk.accountFetcher.getMarkets(allMarketAddresses);
        const [markets, priceFeeds] = await this.getMarketMapAndPriceFeedMap(allMarkets);

        const allMarginAccounts = await this.fetchAllMarginAccounts();

        for (const marginAccount of allMarginAccounts) {
            await this.attemptLiquidation(new ExchangeWrapper(exchange), marginAccount, markets, priceFeeds);
        }
    }

    private async attemptLiquidation(
        exchangeWrapper: ExchangeWrapper,
        marginAccount: MarginAccountWrapper,
        markets: MarketMap, priceFeeds: PriceFeedMap
    ): Promise<void> {
        if (marginAccount.inLiquidation()) {
            console.log(`Liquidating account already in liquidation (${marginAccount.address})`);
            await this.liquidate(marginAccount, markets);
        }

        if (marginAccount.getAccountMargins(exchangeWrapper, markets, priceFeeds, Math.floor(Date.now() / 1000)).canLiquidate()) {
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
            return await sendAndConfirmTransaction(this.connection, tx, [this.liquidatorSigner]);
        } catch (error) {
            console.error("Failed to execute liquidation:", error);
            throw new Error(`Liquidation transaction failed: ${error}`);
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

