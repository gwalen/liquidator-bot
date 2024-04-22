## Liquidator Bot: Solution 1

Changes made:
- Extracted all logic of the liquidator into the TypeScript (TS) class for improved readability and usability.
- Added a liquidator_manager file to facilitate easy setup of the liquidator.
- Added a burst parameter to allow sending multiple liquidation transactions at once (improves the chance that at least one will land).
- Skipped preflight checks when sending transactions for faster processing.
- Added error catching and logging to prevent the bot from crashing due to errors.

The key part is the burst parameter, which should allow safely landing at least one transaction on the chain.

## Additional comments:

Fetching all margin accounts (~215k accounts) takes a significant amount of time and only works on RPC platforms like Helius/QuickNode, 
not on the standard Solana one. This step seems unavoidable. 

I believe that improvements in ensuring transactions land successfully should focus on the method of transmission, either through the burst approach or manual retries.
