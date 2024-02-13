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


    // 5 - Create a transfer instruction


    // 6 - Try to send a transaction without a memo (should fail)


    // 7 - Try to send a transaction with a memo (should succeed)


    // 8 - Disable required memo transfers


    // 9 - Try to send a transaction without a memo (should succeed)


    // 10 - Verify the memo requirement toggle

}

// Call the main function
main().then(() => {
    console.log("🎉 - Demo complete.");
}).catch((err) => {
    console.error("⚠️ - Demo failed: ", err);
});