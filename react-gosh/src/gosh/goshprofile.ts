import { KeyPair, signerKeys, TonClient } from '@eversdk/core'
import { BaseContract } from './base'
import {
    IGoshAdapter,
    IGoshDaoAdapter,
    IGoshProfile,
    IGoshProfileDao,
} from './interfaces'
import { TAddress, TProfileDetails } from '../types'
import { GoshProfileDao } from './goshprofiledao'
import { EGoshError, GoshError } from '../errors'
import { whileFinite } from '../utils'
import { GoshAdapterFactory } from './factories'
import { executeByChunk } from '../helpers'
import { MAX_PARALLEL_READ } from '../constants'

class GoshProfile extends BaseContract implements IGoshProfile {
    static key: string = 'profile'

    constructor(client: TonClient, address: TAddress, keys?: KeyPair) {
        super(client, GoshProfile.key, address, { keys })
    }

    async isOwnerPubkey(pubkey: string): Promise<boolean> {
        if (!pubkey.startsWith('0x')) pubkey = `0x${pubkey}`
        const result = await this.runLocal('isPubkeyCorrect', { pubkey })
        return result.value0
    }

    async getName(): Promise<string> {
        const { value0 } = await this.runLocal('getName', {}, undefined, {
            useCachedBoc: true,
        })
        return value0
    }

    async getDetails(): Promise<TProfileDetails> {
        const custodians = await this.runLocal('getCustodians', {})
        const pubkeys = await this.runLocal('getAccess', {})
        return {
            name: await this.getName(),
            custodians: {
                list: [],
                needed: 1,
            },
        }
    }

    async getProfileDao(name: string): Promise<IGoshProfileDao> {
        const address = await this.runLocal(
            'getProfileDaoAddr',
            {
                name: name.toLowerCase(),
            },
            undefined,
            { useCachedBoc: true },
        )
        return new GoshProfileDao(this.account.client, address.value0)
    }

    async getDaos(): Promise<IGoshDaoAdapter[]> {
        const { messages } = await this.getMessages(
            {
                msgType: ['IntIn'],
                node: ['created_at'],
                allow_latest_inconsistent_data: true,
            },
            true,
            true,
        )

        return await executeByChunk(
            messages.filter(({ decoded }) => {
                if (!decoded) {
                    return false
                }
                const { name, value } = decoded
                return name === 'deployedWallet' && parseInt(value.index) === 0
            }),
            MAX_PARALLEL_READ,
            async ({ decoded }) => {
                const { goshdao, ver } = decoded.value
                const gosh = GoshAdapterFactory.create(ver)
                return await gosh.getDao({ address: goshdao, useAuth: false })
            },
        )
    }

    async getOwners(): Promise<TAddress[]> {
        const owners = await this.runLocal('getAccess', {})
        return Object.keys(owners.value0)
    }

    async getGoshAddress(): Promise<TAddress> {
        const { value0 } = await this.runLocal('getCurrentSystemContract', {})
        return value0
    }

    async deployDao(
        gosh: IGoshAdapter,
        name: string,
        members: TAddress[],
        prev?: TAddress | undefined,
    ): Promise<IGoshDaoAdapter> {
        const { valid, reason } = gosh.isValidDaoName(name)
        if (!valid) throw new GoshError(EGoshError.DAO_NAME_INVALID, reason)

        if (!prev) {
            const profileDao = await this.getProfileDao(name)
            if (await profileDao.isDeployed()) throw new GoshError(EGoshError.DAO_EXISTS)
        }

        let isCompletelyDeployed = false
        await this.account.subscribeMessages(
            'body msg_type',
            async ({ body, msg_type }) => {
                const decoded = await this.decodeMessageBody(body, +msg_type)
                if (decoded?.name === 'deployedWallet') {
                    await this.account.free()
                    isCompletelyDeployed = true
                }
            },
        )

        const dao = await gosh.getDao({ name: name.toLowerCase(), useAuth: false })
        await this.run('deployDao', {
            systemcontract: gosh.gosh.address,
            name: name.toLowerCase(),
            pubmem: members,
            previous: prev || null,
        })

        if (!(await whileFinite(async () => await dao.isDeployed()))) {
            await this.account.free()
            throw new GoshError('Deploy DAO timeout reached')
        }

        if (!(await whileFinite(() => isCompletelyDeployed, 1000))) {
            await this.account.free()
            throw new GoshError('Deploy DAO timeout reached')
        }

        return dao
    }

    async setGoshAddress(address: TAddress): Promise<void> {
        await this.run('setNewSystemContract', { systemcontract: address })
    }

    async turnOn(wallet: TAddress, pubkey: string, keys: KeyPair): Promise<void> {
        if (!pubkey.startsWith('0x')) pubkey = `0x${pubkey}`
        await this.run('turnOn', { wallet, pubkey }, { signer: signerKeys(keys) })
    }
}

export { GoshProfile }
