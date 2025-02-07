import { KeyPair, TonClient } from '@eversdk/core'
import { AppConfig } from '../../appconfig'
import { BaseContract } from '../../blockchain/contract'
import { DaoProfile } from '../../blockchain/daoprofile'
import { VersionController } from '../../blockchain/versioncontroller'
import { GoshError } from '../../errors'
import { whileFinite } from '../../utils'
import GoshABI from './abi/systemcontract.abi.json'
import { Dao } from './dao'
import { DaoWallet } from './daowallet'
import { GoshRepository } from './repository'

export class SystemContract extends BaseContract {
  versionController: VersionController

  constructor(client: TonClient, address: string) {
    super(client, GoshABI, address)
    this.versionController = AppConfig.goshroot
  }

  async getDaoProfile(name: string) {
    const { value0 } = await this.runLocal(
      'getProfileDaoAddr',
      { name },
      undefined,
      {
        useCachedBoc: true,
      },
    )
    return new DaoProfile(this.account.client, value0)
  }

  async getDao(params: { name?: string; address?: string }) {
    const { name, address } = params

    if (address) {
      return new Dao(this.client, address)
    }

    if (name) {
      const { value0 } = await this.runLocal(
        'getAddrDao',
        { name },
        undefined,
        {
          useCachedBoc: true,
        },
      )
      return new Dao(this.client, value0)
    }

    throw new GoshError('DAO name or address required')
  }

  getDaoWallet(params: { address: string; keys?: KeyPair }) {
    return new DaoWallet(this.client, params.address, params.keys)
  }

  async getRepository(options: { path?: string; address?: string }) {
    const { path, address } = options
    if (address) {
      return new GoshRepository(this.client, address)
    }

    if (!path) {
      throw new GoshError('Repository path is undefined')
    }
    const [dao, name] = path.split('/')
    const { value0 } = await this.runLocal(
      'getAddrRepository',
      { dao, name },
      undefined,
      { useCachedBoc: true },
    )
    return new GoshRepository(this.client, value0)
  }

  async getRepositoryCodeHash(daoaddr: string): Promise<string> {
    const { value0 } = await this.runLocal(
      'getRepoDaoCode',
      { dao: daoaddr },
      undefined,
      { useCachedBoc: true },
    )
    const { hash } = await this.client.boc.get_boc_hash({ boc: value0 })
    return hash
  }

  async createUserProfile(username: string, pubkey: string) {
    // Get profile and check it's status
    const profile = await this.versionController.getUserProfile({ username })
    if (await profile.isDeployed()) {
      return profile
    }

    // Deploy profile
    await this.run('deployProfile', { name: username, pubkey })
    const wait = await whileFinite(async () => await profile.isDeployed())
    if (!wait) {
      throw new GoshError('Deploy profile timeout reached')
    }
    return profile
  }
}
