## Liquidator Bot: Solution 2

Changes made:
- Extracted all logic of the liquidator into the TypeScript (TS) class for improved readability and usability.
- Added a liquidator_manager file to facilitate easy setup of the liquidator.
- Added `sendSignedTransactionWithRepeat` function that will manually repeat tx sending 
- Skipped preflight checks when sending transactions for faster processing.
- Added error catching and logging to prevent the bot from crashing due to errors.

The key part in this solution is `sendSignedTransactionWithRepeat` it will send tx in a loop until : 
- define timeout is reached
- tx simulation fails (chain state has changed an tx can no more land)
- tx is failed 
- tx succeeds
- rpc error

This method attaches to th web-socket `getSignatureStatuses` to wait to the tx signature to check if tx landed.

### Note:
`sendSignedTransactionWithRepeat` requires more polishing.

## Additional comments:

Fetching all margin accounts (~215k accounts) takes a significant amount of time and only works on RPC platforms like Helius/QuickNode, 
not on the standard Solana one. This step seems unavoidable. 

I believe that improvements in ensuring transactions land successfully should focus on the method of transmission, either through the burst approach or manual retries.