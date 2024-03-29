// Import necessary functions and constants from the Solana web3.js and SPL Token packages
import {
    sendAndConfirmTransaction,
    Connection,
    Keypair,
    SystemProgram,
    Transaction,
    LAMPORTS_PER_SOL,
    PublicKey,
    SendTransactionError,
} from '@solana/web3.js';
import {
    createMint,
    createEnableRequiredMemoTransfersInstruction,
    createInitializeAccountInstruction,
    disableRequiredMemoTransfers,
    enableRequiredMemoTransfers,
    getAccountLen,
    ExtensionType,
    TOKEN_2022_PROGRAM_ID,
    mintTo,
    createAssociatedTokenAccountIdempotent,
    createTransferCheckedInstruction,
    unpackAccount,
    getMemoTransfer
} from '@solana/spl-token';
import { createMemoInstruction } from '@solana/spl-memo';

// Additional imports required
import { createAccount, createReallocateInstruction } from '@solana/spl-token';

async function main() {

    // Initialize connection to local Solana node
    const connection = new Connection('http://127.0.0.1:8899', 'confirmed');

    // Amount of Tokens to transfer
    const decimals = 9;
    const transferAmount = BigInt(1_000 * Math.pow(10, decimals)); // Transfer 1,000 tokens

    // Define Keypair - payer and owner of the source account
    const payer = Keypair.generate();

    // Define Keypair - mint authority
    const mintAuthority = Keypair.generate();

    // Define Keypair - destination account (owner of the destination account)
    const owner = Keypair.generate();

    // Define destination account (Token Account subject to memo requirement)
    const destinationKeypair = Keypair.generate();
    const destination = destinationKeypair.publicKey;

    // 1 - Request an airdrop for payer
    const airdropSignature = await connection.requestAirdrop(payer.publicKey, 2 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction({ signature: airdropSignature, ...(await connection.getLatestBlockhash()) });

    // 2 - Create a mint
    const mint = await createMint(
        connection,
        payer,
        mintAuthority.publicKey,
        mintAuthority.publicKey,
        decimals,
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID
    );

    // 3 - Create a destination account with memo requirement enabled
    const accountLen = getAccountLen([ExtensionType.MemoTransfer]);
    const lamports = await connection.getMinimumBalanceForRentExemption(accountLen);
    const transaction = new Transaction().add(
        SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            newAccountPubkey: destination,
            space: accountLen,
            lamports,
            programId: TOKEN_2022_PROGRAM_ID,
        }),
        createInitializeAccountInstruction(destination, mint, owner.publicKey, TOKEN_2022_PROGRAM_ID),
        createEnableRequiredMemoTransfersInstruction(destination, owner.publicKey)
    );
    await sendAndConfirmTransaction(connection, transaction, [payer, owner, destinationKeypair], undefined);

    // 4 - Mint tokens to source account (owned by the payer)
    const sourceAccount = await createAssociatedTokenAccountIdempotent(connection, payer, mint, payer.publicKey, {}, TOKEN_2022_PROGRAM_ID);

    await mintTo(
        connection,
        payer,
        mint,
        sourceAccount,
        mintAuthority,
        Number(transferAmount) * 10,
        [],
        undefined,
        TOKEN_2022_PROGRAM_ID
    );

    // 5 - Create a transfer instruction
    const ix = createTransferCheckedInstruction(
        sourceAccount,
        mint,
        destination,
        payer.publicKey,
        transferAmount,
        decimals,
        undefined,
        TOKEN_2022_PROGRAM_ID
    )

    // 6 - Try to send a transaction without a memo (should fail)
    try {
        const failedTx = new Transaction().add(ix);
        const failedTxSig = await sendAndConfirmTransaction(connection, failedTx, [payer], undefined);
        console.log("❌ - This should have failed, but didn't. Tx: ", failedTxSig);
    } catch (e) {
        if (e instanceof SendTransactionError && e.logs) {
            const errorMessage = e.logs.join('\n');
            if (errorMessage.includes("No memo in previous instruction")) {
                // https://github.com/solana-labs/solana-program-library/blob/d755eae17e0a2220f31bfc69548a78be832643af/token/program-2022/src/error.rs#L143
                console.log("✅ - Transaction failed without memo (memo is required).");
            } else {
                console.error(`❌ - Unexpected error: ${errorMessage}`);
            }
        } else {
            console.error(`❌ - Unknown error: ${e}`);
        }
    }

    // 7 - Try to send a transaction with a memo (should succeed)
    try {
        const memo = createMemoInstruction("QuickNode demo.");
        const memoTx = new Transaction().add(memo, ix);
        await sendAndConfirmTransaction(connection, memoTx, [payer], undefined);
        console.log("✅ - Successful transaction with memo (memo is required).");
    } catch (e) {
        console.error("❌ - Something went wrong. Tx failed unexpectedly: ", e);
    }

    // 8 - Disable required memo transfers
    await disableRequiredMemoTransfers(connection, payer, destination, owner);

    // 9 - Try to send a transaction without a memo (should succeed)
    try {
        const noMemoTx = new Transaction().add(ix);
        await sendAndConfirmTransaction(connection, noMemoTx, [payer], undefined);
        console.log("✅ - Successful transaction without memo (memo is NOT required).");
    } catch (e) {
        console.error("❌ - Something went wrong. Tx failed unexpectedly: ", e);
    }

    // 10 - Verify the memo requirement toggle
    let isMemoRequired = await verifyMemoRequirement(destination, connection);
    if (isMemoRequired) {
        console.log("❌ - Something's wrong. Expected memo requirement to be disabled.");
    } else {
        console.log("✅ - Memo requirement disabled.");
    }

    await enableRequiredMemoTransfers(connection, payer, destination, owner);

    isMemoRequired = await verifyMemoRequirement(destination, connection);
    if (isMemoRequired) {
        console.log("✅ - Memo requirement enabled.");
    } else {
        console.log("❌ - Something's wrong. Expected memo to be required.");
    }

     // 11 - Bonus - add memo requirement to an existing account
/*     try {
        // Create a new token account without a memo requirement
        const newOwner = Keypair.generate();
        const bonusAccount = await createAccount(
            connection,
            payer,
            mint,
            newOwner.publicKey,
            undefined,
            undefined,
            TOKEN_2022_PROGRAM_ID
        );
    
        const extensions = [ExtensionType.MemoTransfer];
        const addExtensionTx = new Transaction().add(
            // Create a reallocate instruction to add lamports for the the memo requirement
            createReallocateInstruction(
                bonusAccount,
                payer.publicKey,
                extensions,
                newOwner.publicKey
            ),
            // Create an instruction to enable the memo requirement
            createEnableRequiredMemoTransfersInstruction(bonusAccount, newOwner.publicKey)
        );
        await sendAndConfirmTransaction(connection, addExtensionTx, [payer, newOwner]);
        console.log("✅ - Memo requirement added to existing account.");
    } catch (e) {
        console.error("❌ - Something went wrong. Tx failed unexpectedly: ", e);
    }//*/
}

async function verifyMemoRequirement(tokenAccount: PublicKey, connection: Connection): Promise<boolean> {
    const accountInfo = await connection.getAccountInfo(tokenAccount);
    const account = unpackAccount(tokenAccount, accountInfo, TOKEN_2022_PROGRAM_ID);
    const memoDetails = getMemoTransfer(account);
    if (!memoDetails) {
        throw new Error("Memo details not found.");
    }
    return memoDetails.requireIncomingTransferMemos;
}
// Call the main function
main().then(() => {
    console.log("🎉 - Demo complete.");
}).catch((err) => {
    console.error("⚠️ - Demo failed: ", err);
});