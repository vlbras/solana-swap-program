import { randomBytes } from "node:crypto";
import * as anchor from "@coral-xyz/anchor";
import { BN, type Program } from "@coral-xyz/anchor";
import {
  TOKEN_2022_PROGRAM_ID,
  type TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { assert } from "chai";
import type { Swap } from "../target/types/swap";

import {
  confirmTransaction,
  createAccountsMintsAndTokenAccounts,
  makeKeypairs,
} from "@solana-developers/helpers";

const TOKEN_PROGRAM: typeof TOKEN_2022_PROGRAM_ID | typeof TOKEN_PROGRAM_ID =
  TOKEN_2022_PROGRAM_ID;

const SECONDS = 1000;
const ANCHOR_SLOW_TEST_THRESHOLD = 40 * SECONDS;

const getRandomBigNumber = (size = 8) => {
  return new BN(randomBytes(size));
};

describe("swap", async () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const payer = (provider.wallet as anchor.Wallet).payer;

  const connection = provider.connection;

  const program = anchor.workspace.Swap as Program<Swap>;

  const accounts: Record<string, PublicKey> = {
    tokenProgram: TOKEN_PROGRAM,
  };

  let vlad: anchor.web3.Keypair;
  let maxim: anchor.web3.Keypair;

  let [tokenMintA, tokenMintB] = makeKeypairs(4);

  const tokenAOfferedAmount = new BN(1_000_000);
  const tokenBWantedAmount = new BN(1_000_000);

  before(
    "Creates Vlad and Maxim accounts, 2 token mints, and associated token accounts for both tokens for both users",
    async () => {
      const usersMintsAndTokenAccounts =
        await createAccountsMintsAndTokenAccounts(
          [
            // Vlad's token balances
            [
              // 1_000_000_000 of token A
              1_000_000_000,
              // 0 of token B
              0,
            ],
            // Maxim's token balances
            [
              // 0 of token A
              0,
              // 1_000_000_000 of token B
              1_000_000_000,
            ],
          ],
          1 * LAMPORTS_PER_SOL,
          connection,
          payer
        );

      [vlad, maxim] = usersMintsAndTokenAccounts.users;

      const mints = usersMintsAndTokenAccounts.mints;
      tokenMintA = mints[0];
      tokenMintB = mints[1];

      const tokenAccounts = usersMintsAndTokenAccounts.tokenAccounts;

      const vladTokenAccountA = tokenAccounts[0][0];
      const vladTokenAccountB = tokenAccounts[0][1];

      const maximTokenAccountA = tokenAccounts[1][0];
      const maximTokenAccountB = tokenAccounts[1][1];

      // Save the accounts for later use
      accounts.maker = vlad.publicKey;
      accounts.taker = maxim.publicKey;
      accounts.tokenMintA = tokenMintA.publicKey;
      accounts.makerTokenAccountA = vladTokenAccountA;
      accounts.takerTokenAccountA = maximTokenAccountA;
      accounts.tokenMintB = tokenMintB.publicKey;
      accounts.makerTokenAccountB = vladTokenAccountB;
      accounts.takerTokenAccountB = maximTokenAccountB;
    }
  );

  it("Puts the tokens Vlad offers into the vault when Vlad makes an offer", async () => {
    const offerId = getRandomBigNumber();

    const offer = PublicKey.findProgramAddressSync(
      [
        Buffer.from("offer"),
        accounts.maker.toBuffer(),
        offerId.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    )[0];

    const vault = getAssociatedTokenAddressSync(
      accounts.tokenMintA,
      offer,
      true,
      TOKEN_PROGRAM
    );

    accounts.offer = offer;
    accounts.vault = vault;

    const transactionSignature = await program.methods
      .makeOffer(offerId, tokenAOfferedAmount, tokenBWantedAmount)
      .accounts({ ...accounts })
      .signers([vlad])
      .rpc();

    await confirmTransaction(connection, transactionSignature);

    const vaultBalanceResponse = await connection.getTokenAccountBalance(vault);
    const vaultBalance = new BN(vaultBalanceResponse.value.amount);
    assert(vaultBalance.eq(tokenAOfferedAmount));

    const offerAccount = await program.account.offer.fetch(offer);

    assert(offerAccount.maker.equals(vlad.publicKey));
    assert(offerAccount.tokenMintA.equals(accounts.tokenMintA));
    assert(offerAccount.tokenMintB.equals(accounts.tokenMintB));
    assert(offerAccount.tokenBWantedAmount.eq(tokenBWantedAmount));
  }).slow(ANCHOR_SLOW_TEST_THRESHOLD);

  it("Puts the tokens from the vault into Maxim's account, and gives Vlad Maxim's tokens, when Maxim takes an offer", async () => {
    const transactionSignature = await program.methods
      .takeOffer()
      .accounts({ ...accounts })
      .signers([maxim])
      .rpc();

    await confirmTransaction(connection, transactionSignature);

    const maximTokenAccountBalanceAfterResponse =
      await connection.getTokenAccountBalance(accounts.takerTokenAccountA);
    const maximTokenAccountBalanceAfter = new BN(
      maximTokenAccountBalanceAfterResponse.value.amount
    );
    assert(maximTokenAccountBalanceAfter.eq(tokenAOfferedAmount));

    const vladTokenAccountBalanceAfterResponse =
      await connection.getTokenAccountBalance(accounts.makerTokenAccountB);
    const vladTokenAccountBalanceAfter = new BN(
      vladTokenAccountBalanceAfterResponse.value.amount
    );
    assert(vladTokenAccountBalanceAfter.eq(tokenBWantedAmount));
  }).slow(ANCHOR_SLOW_TEST_THRESHOLD);
});
