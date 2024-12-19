import { LitNodeClient } from "@lit-protocol/lit-node-client";
import {
    LIT_ABILITY,
    LIT_RPC,
    AUTH_METHOD_SCOPE,
} from "@lit-protocol/constants";
import { LitActionResource, LitPKPResource } from "@lit-protocol/auth-helpers";
import { LitContracts } from "@lit-protocol/contracts-sdk";
import { EthWalletProvider } from "@lit-protocol/lit-auth-client";
import { LIT_NETWORKS_KEYS } from "@lit-protocol/types";
import * as ethers from "ethers";
import bs58 from "bs58";
import {
    Connection,
    PublicKey,
    SystemProgram,
    Transaction,
    clusterApiUrl,
    Cluster
} from "@solana/web3.js";
import { api } from "@lit-protocol/wrapped-keys";
const { generatePrivateKey, signTransactionWithEncryptedKey, getEncryptedKey } =
    api;
import {
    getAssociatedTokenAddress,
    createAssociatedTokenAccountInstruction,
    createTransferInstruction,
} from "@solana/spl-token";

interface PKP {
    tokenId: string;
    publicKey: string;
    ethAddress: string;
}

interface WK {
    pkpAddress: string;
    id: string;
    generatedPublicKey: string;
}

interface addPermittedActionParams {
    userPrivateKey: string;
    pkpTokenId: string;
    litActionCode: string;
    pinataAPI: string;
}

interface uploadViaPinataParams {
    pinataAPI: string;
    litActionCode: string;
}

interface createPKPWithLitActionParams {
    userPrivateKey: string;
    litActionCode: string;
    pinataAPI: string;
}

interface executeLitActionParams {
    userPrivateKey: string;
    pkpPublicKey: string;
    litActionIpfsCid?: string;
    litActionCode?: string;
    params?: Object;
}

enum FlagForLitTxn {
    SOL,
    CUSTOM,
}

interface conditionalSigningOnSolanaParams {
    userPrivateKey: string,
    litTransaction: any,
    broadcastTransaction: boolean,
    conditionLogic: string
    pkp?: PKP,
    wk?: WK,
}

interface createSerializedLitTxnParams {
    toAddress: string;
    amount: number;
    network: Cluster;
    flag: FlagForLitTxn;
    tokenMintAddress?: string;
    wk?: WK;
}

interface sendSolanaWKTxnWithSolParams {
    amount: number;
    toAddress: string;
    network: Cluster;
    broadcastTransaction: boolean;
    userPrivateKey: string;
    wk?: WK;
    pkp?: PKP;
}

interface sendSolanaWKTxnWithCustomTokenParams {
    tokenMintAddress: string;
    amount: number;
    toAddress: string;
    network: Cluster;
    broadcastTransaction: boolean;
    userPrivateKey: string;
    wk?: WK;
    pkp?: PKP;
}

class LitWrapper {
    private litNodeClient: LitNodeClient;
    private litNetwork: LIT_NETWORKS_KEYS;
    private pkp: PKP | null;
    private wk: WK | null;

    constructor(litNetwork: LIT_NETWORKS_KEYS) {
        this.litNetwork = litNetwork;
        this.litNodeClient = new LitNodeClient({
            litNetwork: this.litNetwork,
            debug: false,
        });
        this.pkp = null;
        this.wk = null;
    }

    async createPKP(userPrivateKey: string) {
        try {
            const ethersWallet = new ethers.Wallet(
                userPrivateKey,
                new ethers.providers.JsonRpcProvider(
                    LIT_RPC.CHRONICLE_YELLOWSTONE
                )
            );

            const litContracts = new LitContracts({
                signer: ethersWallet,
                network: this.litNetwork,
                debug: false,
            });
            await litContracts.connect();

            const pkp = (await litContracts.pkpNftContractUtils.write.mint())
                .pkp;
            this.pkp = pkp;
            return pkp;
        } catch (error) {
            console.error(error);
        }
    }

    async addPermittedAction({
        userPrivateKey,
        pkpTokenId,
        litActionCode,
        pinataAPI,
    }: addPermittedActionParams) {
        const ipfsCID = await this.uploadViaPinata({
            pinataAPI,
            litActionCode,
        });

        const ethersWallet = new ethers.Wallet(
            userPrivateKey,
            new ethers.providers.JsonRpcProvider(LIT_RPC.CHRONICLE_YELLOWSTONE)
        );

        const litContracts = new LitContracts({
            signer: ethersWallet,
            network: this.litNetwork,
            debug: false,
        });
        await litContracts.connect();

        await litContracts.addPermittedAction({
            pkpTokenId: pkpTokenId,
            ipfsId: ipfsCID,
            authMethodScopes: [AUTH_METHOD_SCOPE.SignAnything],
        });

        return ipfsCID;
    }

    async uploadViaPinata({ pinataAPI, litActionCode }: uploadViaPinataParams) {
        const formData = new FormData();

        const file = new File([litActionCode], "Action.txt", {
            type: "text/plain",
        });
        const pinataMetadata = JSON.stringify({
            name: "EVM-SWAP",
        });
        const pinataOptions = JSON.stringify({
            cidVersion: 0,
        });

        formData.append("file", file);
        formData.append("pinataMetadata", pinataMetadata);
        formData.append("pinataOptions", pinataOptions);

        const request = await fetch(
            "https://api.pinata.cloud/pinning/pinFileToIPFS",
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${pinataAPI}`,
                },
                body: formData,
            }
        );
        const response = await request.json();
        console.log(response);
        return response.IpfsHash;
    }

    async checkPermits(pkpTokenId: string, litActionCID: string) {
        console.log("checking perms..");

        const litContracts = new LitContracts({
            network: this.litNetwork,
            debug: false,
        });
        await litContracts.connect();

        let CIDinHex = `0x${Buffer.from(bs58.decode(litActionCID)).toString(
            "hex"
        )}`;
        let permittedActions =
            await litContracts.pkpPermissionsContract.read.getPermittedActions(
                pkpTokenId
            );
        let permittedAuthMethods =
            await litContracts.pkpPermissionsContract.read.getPermittedAuthMethods(
                pkpTokenId
            );
        let permittedAddresses =
            await litContracts.pkpPermissionsContract.read.getPermittedAddresses(
                pkpTokenId
            );

        const results = {
            litAction: {
                cid: litActionCID,
                hex: CIDinHex,
            },
            permissions: {
                actions: permittedActions,
                authMethods: permittedAuthMethods,
                addresses: permittedAddresses,
            },
        };
        console.log(results);
        return results;
    }

    async createPKPWithLitAction({
        userPrivateKey,
        litActionCode,
        pinataAPI,
    }: createPKPWithLitActionParams) {
        await this.createPKP(userPrivateKey);
        if (!this.pkp) {
            throw new Error("PKP not initialized");
        }

        const ipfsCID = this.addPermittedAction({
            userPrivateKey,
            pkpTokenId: this.pkp.tokenId,
            litActionCode,
            pinataAPI,
        });
        let pkp = this.pkp;
        return { pkp, ipfsCID };
    }

    async createPKPSessionSigs(userPrivateKey: string, pkpPublicKey: string) {
        try {
            if (!this.litNodeClient.ready) {
                await this.litNodeClient.connect();
            }

            const ethersWallet = new ethers.Wallet(
                userPrivateKey,
                new ethers.providers.JsonRpcProvider(
                    LIT_RPC.CHRONICLE_YELLOWSTONE
                )
            );

            const authMethod = await EthWalletProvider.authenticate({
                signer: ethersWallet,
                litNodeClient: this.litNodeClient,
            });

            const pkpSessionSigs = await this.litNodeClient.getPkpSessionSigs({
                pkpPublicKey: pkpPublicKey,
                chain: "ethereum",
                authMethods: [authMethod],
                resourceAbilityRequests: [
                    {
                        resource: new LitActionResource("*"),
                        ability: LIT_ABILITY.LitActionExecution,
                    },
                    {
                        resource: new LitPKPResource("*"),
                        ability: LIT_ABILITY.PKPSigning,
                    },
                ],
                expiration: new Date(Date.now() + 1000 * 60 * 10).toISOString(), // 10 minutes
            });

            return pkpSessionSigs;
        } catch (error) {
            console.error(error);
        }
    }

    async getSessionSigs(
        userPrivateKey: string,
        pkpPublicKey: string,
        type: string
    ) {
        const response = await this.createPKPSessionSigs(
            userPrivateKey,
            pkpPublicKey
        );
        if (!response) {
            throw new Error("Failed to get session sigs");
        }
        return response;
    }

    async executeLitAction({
        userPrivateKey,
        pkpPublicKey,
        litActionIpfsCid,
        litActionCode,
        params,
    }: executeLitActionParams) {
        try {
            if (!this.litNodeClient.ready) {
                await this.litNodeClient.connect();
            }

            const result = await this.litNodeClient.executeJs({
                sessionSigs: await this.getSessionSigs(
                    userPrivateKey,
                    pkpPublicKey,
                    "pkp"
                ),
                ipfsId: litActionIpfsCid,
                code: litActionCode,
                jsParams: { ...params },
            });

            return result;
        } catch (error) {
            console.error(error);
        }
    }

    async createSolanaWK(userPrivateKey: string) {
        const litNodeClient = new LitNodeClient({
            litNetwork: this.litNetwork,
            debug: false,
        });
        try {
            await this.createPKP(userPrivateKey);

            if (!this.pkp) {
                throw new Error("PKP not initialized");
            }

            const wrappedKeyInfo = await generatePrivateKey({
                pkpSessionSigs: await this.getSessionSigs(
                    userPrivateKey,
                    this.pkp.publicKey,
                    "pkp"
                ),
                network: "solana",
                memo: "This is a test memo",
                litNodeClient,
            });

            if (!wrappedKeyInfo) {
                throw new Error("Failed to generate wrapped key");
            }

            const response = {
                pkpInfo: this.pkp as PKP,
                wkInfo: wrappedKeyInfo as WK,
            };

            console.log("res: ", response);
            return response;
        } catch (error) {
            console.error;
        } finally {
            litNodeClient?.disconnect();
        }
    }

    async conditionalSigningOnSolana({
        userPrivateKey,
        pkp,
        wk,
        litTransaction,
        broadcastTransaction,
        conditionLogic
    }: conditionalSigningOnSolanaParams) {
        if (pkp) {
            this.pkp = pkp;
        }
        if (wk) {
            this.wk = wk;
        }
        if (!this.pkp) {
            throw new Error("PKP not initialized");
        }
        if (!this.wk) {
            throw new Error("WK not initialized");
        }

        try {
            this.litNodeClient.connect();

            const {
                ciphertext: solanaCipherText,
                dataToEncryptHash: solanaDataToEncryptHash,
            } = await getEncryptedKey({
                pkpSessionSigs: await this.getSessionSigs(
                    userPrivateKey,
                    this.pkp.publicKey,
                    "pkp"
                ),
                litNodeClient: this.litNodeClient,
                id: this.wk.id,
            });

            const combinedCode = `
            async function createSignatureWithAction() {
                const response = await Lit.Actions.call({ 
                    ipfsId: "QmR1nPG2tnmC72zuCEMZUZrrMEkbDiMPNHW45Dsm2n7xnk", 
                    params: {
                        accessControlConditions,
                        ciphertext,
                        dataToEncryptHash,
                        unsignedTransaction,
                        broadcast: false,
                    }
                });
                return response;
            }
            async function run() {
                try {
                    let response;
                    ${conditionLogic.replace('createSignatureWithAction();', 'response = await createSignatureWithAction();')}
                    Lit.Actions.setResponse({ response: response });
                } catch (error) {
                    Lit.Actions.setResponse({ response: error.message });
                }
            }
            run();`;

            const wkAccessControlConditions: Object = {
                contractAddress: "",
                standardContractType: "",
                chain: "ethereum",
                method: "",
                parameters: [":userAddress"],
                returnValueTest: {
                    comparator: "=",
                    value: this.pkp.ethAddress,
                },
            };

            if (!this.litNodeClient.ready) {
                await this.litNodeClient.connect();
            }

            const result = await this.litNodeClient.executeJs({
                sessionSigs: await this.getSessionSigs(
                    userPrivateKey,
                    this.pkp.publicKey,
                    "pkp"
                ),
                code: combinedCode,
                jsParams: {
                    pkpAddress: this.pkp.ethAddress,
                    ciphertext: solanaCipherText,
                    dataToEncryptHash: solanaDataToEncryptHash,
                    unsignedTransaction: litTransaction,
                    broadcast: broadcastTransaction,
                    accessControlConditions: [wkAccessControlConditions],
                },
            });

            console.log(result);

            return result
        } catch (error) {
            console.error(error);
        } finally {
            this.litNodeClient?.disconnect();
        }
    }

    async sendSolanaWKTxnWithSol({
        amount,
        toAddress,
        network,
        broadcastTransaction,
        userPrivateKey,
        wk,
        pkp,
    }: sendSolanaWKTxnWithSolParams) {
        if (pkp) {
            this.pkp = pkp;
        }
        if (wk) {
            this.wk = wk;
        }
        if (!this.pkp) {
            throw new Error("PKP not initialized");
        }
        if (!this.wk) {
            throw new Error("WK not initialized");
        }

        try {
            const litTransaction = await this.createSerializedLitTxn({
                wk,
                toAddress,
                amount,
                network,
                flag: FlagForLitTxn.SOL
            });

            await this.litNodeClient.connect();
            if (!litTransaction) {
                throw new Error("Failed to create Lit Transaction");
            }

            const signedTransaction = await signTransactionWithEncryptedKey({
                pkpSessionSigs: await this.getSessionSigs(
                    userPrivateKey,
                    this.pkp.publicKey,
                    "pkp"
                ),
                network: "solana",
                id: this.wk.id,
                unsignedTransaction: litTransaction,
                broadcast: broadcastTransaction,
                litNodeClient: this.litNodeClient,
            });
            return signedTransaction;
        } catch (error) {
            console.error(error);
        } finally {
            this.litNodeClient?.disconnect();
        }
    }

    async sendSolanaWKTxnWithCustomToken({
        tokenMintAddress,
        amount,
        toAddress,
        network,
        broadcastTransaction,
        userPrivateKey,
        wk,
        pkp,
    }: sendSolanaWKTxnWithCustomTokenParams) {
        if (pkp) {
            this.pkp = pkp;
        }
        if (wk) {
            this.wk = wk;
        }
        if (!this.pkp) {
            throw new Error("PKP not initialized");
        }
        if (!this.wk) {
            throw new Error("WK not initialized");
        }

        try {
            const litTransaction = await this.createSerializedLitTxn({
                wk: this.wk,
                toAddress,
                amount,
                network,
                flag: FlagForLitTxn.CUSTOM,
                tokenMintAddress: tokenMintAddress,
            });

            if (!litTransaction) {
                throw new Error("Failed to create Lit Transaction");
            }

            await this.litNodeClient.connect();

            const signedTransaction = await signTransactionWithEncryptedKey({
                pkpSessionSigs: await this.getSessionSigs(
                    userPrivateKey,
                    this.pkp.publicKey,
                    "pkp"
                ),
                network: "solana",
                id: this.wk.id,
                unsignedTransaction: litTransaction,
                broadcast: broadcastTransaction,
                litNodeClient: this.litNodeClient,
            });
            return signedTransaction;
        } catch (error) {
            console.error(error);
        } finally {
            this.litNodeClient?.disconnect();
        }
    }

    async createSerializedLitTxn({
        toAddress,
        amount,
        network,
        flag,
        tokenMintAddress,
        wk,
    }: createSerializedLitTxnParams) {
        if (wk) {
            this.wk = wk;
        }
        if (!this.wk) {
            throw new Error("WK not initialized");
        }

        try {
            const generatedSolanaPublicKey = new PublicKey(
                this.wk.generatedPublicKey
            );

            const receiverPublicKey = new PublicKey(toAddress);

            // console.log("Sending from address: ", generatedSolanaPublicKey.toString());
            // console.log("Sending to address: ", receiverPublicKey.toString());

            const solanaConnection = new Connection(
                clusterApiUrl(network),
                "confirmed"
            );

            const { blockhash } = await solanaConnection.getLatestBlockhash();

            if (flag == FlagForLitTxn.SOL) {
                const solanaTransaction = new Transaction();
                solanaTransaction.add(
                    SystemProgram.transfer({
                        fromPubkey: generatedSolanaPublicKey,
                        toPubkey: receiverPublicKey,
                        lamports: amount,
                    })
                );
                solanaTransaction.feePayer = generatedSolanaPublicKey;

                solanaTransaction.recentBlockhash = blockhash;

                const serializedTransaction = solanaTransaction
                    .serialize({
                        requireAllSignatures: false, // should be false as we're not signing the message
                        verifySignatures: false, // should be false as we're not signing the message
                    })
                    .toString("base64");

                const litTransaction = {
                    serializedTransaction,
                    chain: network,
                };
                return litTransaction;
            } else if (flag == FlagForLitTxn.CUSTOM) {
                if (tokenMintAddress == undefined) {
                    console.error(
                        "Token mint address is required for custom token transfer txn"
                    );
                    return;
                }

                const tokenAccount = await getAssociatedTokenAddress(
                    new PublicKey(tokenMintAddress),
                    generatedSolanaPublicKey
                );

                const destinationAccount = await getAssociatedTokenAddress(
                    new PublicKey(tokenMintAddress),
                    receiverPublicKey
                );

                const transaction = new Transaction();

                // Check if destination token account exists
                const destinationAccountInfo =
                    await solanaConnection.getAccountInfo(destinationAccount);
                if (!destinationAccountInfo) {
                    transaction.add(
                        createAssociatedTokenAccountInstruction(
                            generatedSolanaPublicKey,
                            destinationAccount,
                            receiverPublicKey,
                            new PublicKey(tokenMintAddress)
                        )
                    );
                }

                // Add transfer instruction
                transaction.add(
                    createTransferInstruction(
                        tokenAccount,
                        destinationAccount,
                        generatedSolanaPublicKey,
                        amount
                    )
                );

                transaction.feePayer = generatedSolanaPublicKey;

                const { blockhash } =
                    await solanaConnection.getLatestBlockhash();
                transaction.recentBlockhash = blockhash;

                const serializedTransaction = transaction
                    .serialize({
                        requireAllSignatures: false,
                        verifySignatures: false,
                    })
                    .toString("base64");

                const litTransaction = {
                    serializedTransaction,
                    chain: network,
                };
                return litTransaction;
            } else {
                console.error("Invalid flag for Lit Transaction");
            }
        } catch (error) {
            console.error(error);
        }
    }
}

interface testLitActionParams {
    litActionCode: string;
    params: Object;
}

class LitTester {
    public litNetwork: LIT_NETWORKS_KEYS;
    public pkp: PKP | null;
    public userPrivateKey: any;
    public initialized: boolean;

    constructor(userPrivateKey: string, litNetwork: LIT_NETWORKS_KEYS) {
        this.litNetwork = litNetwork;
        this.userPrivateKey = userPrivateKey;
        this.pkp = null;
        this.initialized = false;
    }

    static async init(userPrivateKey: string, litNetwork: LIT_NETWORKS_KEYS) {
        const instance = new LitTester(userPrivateKey, litNetwork);
        await instance.initializePKP();
        return instance;
    }

    async initializePKP() {
        if (this.initialized) return;

        try {
            const ethersWallet = new ethers.Wallet(
                this.userPrivateKey,
                new ethers.providers.JsonRpcProvider(
                    LIT_RPC.CHRONICLE_YELLOWSTONE
                )
            );

            const litContracts = new LitContracts({
                signer: ethersWallet,
                network: this.litNetwork,
                debug: false,
            });
            await litContracts.connect();

            const pkp = (await litContracts.pkpNftContractUtils.write.mint())
                .pkp;
            this.pkp = pkp;
            console.log("PKP: ", this.pkp);
            this.initialized = true;
        } catch (error) {
            console.error(error);
            throw error;
        }
    }

    async testLitAction({ litActionCode, params }: testLitActionParams) {
        if (!this.pkp) {
            throw new Error("PKP not initialized");
        }

        const litNodeClient = new LitNodeClient({
            litNetwork: this.litNetwork,
            debug: false,
        });
        try {
            await litNodeClient.connect();

            const ethersWallet = new ethers.Wallet(
                this.userPrivateKey,
                new ethers.providers.JsonRpcProvider(
                    LIT_RPC.CHRONICLE_YELLOWSTONE
                )
            );

            const authMethod = await EthWalletProvider.authenticate({
                signer: ethersWallet,
                litNodeClient,
            });

            const pkpSessionSigs = await litNodeClient.getPkpSessionSigs({
                pkpPublicKey: this.pkp.publicKey,
                chain: "ethereum",
                authMethods: [authMethod],
                resourceAbilityRequests: [
                    {
                        resource: new LitActionResource("*"),
                        ability: LIT_ABILITY.LitActionExecution,
                    },
                    {
                        resource: new LitPKPResource("*"),
                        ability: LIT_ABILITY.PKPSigning,
                    },
                ],
            });

            const result = await litNodeClient.executeJs({
                sessionSigs: pkpSessionSigs,
                code: litActionCode,
                jsParams: { pkpPublicKey: this.pkp.publicKey, ...params },
            });
            return result;
        } catch (error) {
            console.error(error);
        } finally {
            litNodeClient?.disconnect();
        }
    }
}

export { LitWrapper, LitTester, FlagForLitTxn };
