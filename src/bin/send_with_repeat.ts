// import { notify } from './notifications';
import {
  Connection,
  SimulatedTransactionResponse,
  Transaction,
  TransactionSignature,
  Commitment,
  RpcResponseAndContext,
} from '@solana/web3.js';

const DEFAULT_TIMEOUT = 30000;


export async function sendSignedTransaction({
    signedTransaction,
    connection,
    // sendingMessage = 'Sending transaction...',
    // sentMessage = 'Transaction sent',
    // successMessage = 'Transaction confirmed',
    timeout = DEFAULT_TIMEOUT,
  }: {
    signedTransaction: Transaction;
    connection: Connection;
    timeout?: number;
  }): Promise<string> {
    const rawTransaction = signedTransaction.serialize();
    const startTime = getUnixTs();
    // notify({ message: sendingMessage });
    const txid: TransactionSignature = await connection.sendRawTransaction(
      rawTransaction,
      {
        skipPreflight: true,
      },
    );
    // notify({ message: sentMessage, type: 'success', txid });
  
    console.log('Started awaiting confirmation for', txid);
  
    let done = false;
    (async () => {
      while (!done && getUnixTs() - startTime < timeout) {
        connection.sendRawTransaction(rawTransaction, {
          skipPreflight: true,
        });
        await sleep(300);
      }
    })();
    try {
      await awaitTransactionSignatureConfirmation(txid, timeout, connection);
    } catch (err) {
      if (err.timeout) {
        throw new Error('Timed out awaiting confirmation on transaction');
      }
      let simulateResult: SimulatedTransactionResponse | null = null;
      try {
        simulateResult = (
          await simulateTransaction(connection, signedTransaction, 'confirmed')
        ).value;
      } catch (e) {}
      if (simulateResult && simulateResult.err) {
        if (simulateResult.logs) {
          for (let i = simulateResult.logs.length - 1; i >= 0; --i) {
            const line = simulateResult.logs[i];
            if (line.startsWith('Program log: ')) {
              throw new Error(
                'Transaction failed: ' + line.slice('Program log: '.length),
              );
            }
          }
        }
        throw new Error(JSON.stringify(simulateResult.err));
      }
      throw new Error('Transaction failed');
    } finally {
      done = true;
    }
    // notify({ message: successMessage, type: 'success', txid });
  
    console.log('Latency', txid, getUnixTs() - startTime);
    return txid;
  }
  
  async function awaitTransactionSignatureConfirmation(
    txid: TransactionSignature,
    timeout: number,
    connection: Connection,
  ) {
    let done = false;
    const result = await new Promise((resolve, reject) => {
      (async () => {
        setTimeout(() => {
          if (done) {
            return;
          }
          done = true;
          console.log('Timed out for txid', txid);
          reject({ timeout: true });
        }, timeout);
        try {
          connection.onSignature(
            txid,
            (result) => {
              console.log('WS confirmed', txid, result);
              done = true;
              if (result.err) {
                reject(result.err);
              } else {
                resolve(result);
              }
            },
            connection.commitment,
          );
          console.log('Set up WS connection', txid);
        } catch (e) {
          done = true;
          console.log('WS error in setup', txid, e);
        }
        while (!done) {
          // eslint-disable-next-line no-loop-func
          (async () => {
            try {
              const signatureStatuses = await connection.getSignatureStatuses([
                txid,
              ]);
              const result = signatureStatuses && signatureStatuses.value[0];
              if (!done) {
  
                if (!result) {
                  // console.log('REST null result for', txid, result);
                } else if (result.err) {
                  console.log('REST error for', txid, result);
                  done = true;
                  reject(result.err);
                }
                // @ts-ignore
                else if (!(result.confirmations || result.confirmationStatus === "confirmed" || result.confirmationStatus === "finalized")) {
                  console.log('REST not confirmed', txid, result);
                } else {
                  console.log('REST confirmed', txid, result);
                  done = true;
                  resolve(result);
                }
              }
            }
            catch (e) {
              if (!done) {
                console.log('REST connection error: txid', txid, e);
              }
            }
          })();
          await sleep(300);
        }
      })();
    });
    done = true;
    return result;
  }

  async function simulateTransaction(
    connection: Connection,
    transaction: Transaction,
    commitment: Commitment,
  ): Promise<RpcResponseAndContext<SimulatedTransactionResponse>> {
    // @ts-ignore
    // transaction.recentBlockhash = await connection._recentBlockhash(
    //   // @ts-ignore
    //   connection._disableBlockhashCaching,
    // );
    transaction.recentBlockhash = await connection.getLatestBlockhash();
  
    const signData = transaction.serializeMessage();
    // @ts-ignore
    const wireTransaction = transaction._serialize(signData);
    const encodedTransaction = wireTransaction.toString('base64');
    const config: any = { encoding: 'base64', commitment };
    const args = [encodedTransaction, config];
  
    // @ts-ignore
    const res = await connection._rpcRequest('simulateTransaction', args);
    if (res.error) {
      throw new Error('failed to simulate transaction: ' + res.error.message);
    }
    return res.result;
  }

const getUnixTs = () => {
    return new Date().getTime() / 1000;
  };

async function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}