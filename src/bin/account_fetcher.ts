// import { clusterApiUrl } from "@solana/web3.js";
import {
    ParclV3Sdk,
} from "@parcl-oss/v3-sdk";

(async function main() {
//   const sdk = new ParclV3Sdk({ rpcUrl: clusterApiUrl("mainnet-beta") });
  const sdk = new ParclV3Sdk({ rpcUrl: "https://mainnet.helius-rpc.com/?api-key=5d08ec2b-655e-43e6-82e4-88c42024d196" });
//   console.log(await sdk.accountFetcher.getExchange("82dGS7Jt4Km8ZgwZVRsJ2V6vPXEhVdgDaMP7cqPGG1TW"));
//   console.log(await sdk.accountFetcher.getMarket("7UHPEqFRVgyYtjXuXdL3hxwP8NMBQoeSxBSy23xoKrnG"));
//   console.log(await sdk.accountFetcher.getMarginAccount("HVptGRTGDt8FyTwuzEmSgZAPqEoPNqeRcn9eKcmpgSae"));
//   console.log(await sdk.accountFetcher.getMarginAccount("7MvXJRYURdWjHVzaVyzn9iyBACMJBWyvhp7fx9cF8BT7"));

  // need premium url
  console.log((await sdk.accountFetcher.getAllMarginAccounts()).length);
  // total amount : 215 313
})();