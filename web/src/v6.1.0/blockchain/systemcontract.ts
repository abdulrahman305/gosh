import { KeyPair, TonClient } from '@eversdk/core'
import { AppConfig } from '../../appconfig'
import { BaseContract } from '../../blockchain/contract'
import { DaoProfile } from '../../blockchain/daoprofile'
import { VersionController } from '../../blockchain/versioncontroller'
import { GoshError } from '../../errors'
import { whileFinite } from '../../utils'
import { THackathonAppIndex } from '../types/hackathon.types'
import GoshABI from './abi/systemcontract.abi.json'
import { GoshCommitTag } from './committag'
import { Dao } from './dao'
import { DaoWallet } from './daowallet'
import { GoshTag } from './goshtag'
import { Milestone } from './milestone'
import { GoshRepository } from './repository'
import { Task } from './task'

export class SystemContract extends BaseContract {
  versionController: VersionController

  constructor(client: TonClient, address: string) {
    super(client, GoshABI, address)
    this.versionController = AppConfig.goshroot
  }

  async getGoshTag(params: { address: string }) {
    const { address } = params
    return new GoshTag(this.client, address)
  }

  async getCommitTag(params: {
    address?: string
    data?: { daoname: string; reponame: string; tagname: string }
  }) {
    const { address, data } = params

    if (!address && !data) {
      throw new GoshError('Value error', 'Data or address not passed')
    }

    if (address) {
      return new GoshCommitTag(this.client, address)
    }

    // Get commit tag by data
    const { daoname, reponame, tagname } = data!
    const { value0 } = await this.runLocal('getTagAddress', {
      daoName: daoname,
      repoName: reponame,
      tagName: tagname,
    })
    return new GoshCommitTag(this.client, value0)
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

  async getDaoTaskTagCodeHash(daoaddr: string, tag: string): Promise<string> {
    const { value0 } = await this.runLocal(
      'getTaskTagDaoCode',
      { dao: daoaddr, tag },
      undefined,
      { useCachedBoc: true },
    )
    const { hash } = await this.client.boc.get_boc_hash({ boc: value0 })
    return hash
  }

  async getDaoRepositoryTagCodeHash(
    daoaddr: string,
    tag: string,
  ): Promise<string> {
    const { value0 } = await this.runLocal(
      'getRepoTagDaoCode',
      { dao: daoaddr, repotag: tag },
      undefined,
      { useCachedBoc: true },
    )
    const { hash } = await this.client.boc.get_boc_hash({ boc: value0 })
    return hash
  }

  async getTask(options: {
    address?: string
    data?: {
      daoname: string
      reponame: string
      taskname: string
    }
  }) {
    const { address, data } = options

    if (!address && !data) {
      throw new GoshError('Value error', 'Data or address not passed')
    }

    let _address = address
    if (!_address) {
      const { daoname, reponame, taskname } = data!
      const { value0 } = await this.runLocal('getTaskAddr', {
        dao: daoname,
        repoName: reponame,
        nametask: taskname,
      })
      _address = value0
    }

    return new Task(this.client, _address!)
  }

  async getMilestone(options: {
    address?: string
    data?: {
      daoname: string
      reponame: string
      taskname: string
    }
  }) {
    const { address, data } = options

    if (!address && !data) {
      throw new GoshError('Value error', 'Data or address not passed')
    }

    let _address = address
    if (!_address) {
      const { daoname, reponame, taskname } = data!
      const { value0 } = await this.runLocal('getBigTaskAddr', {
        dao: daoname,
        repoName: reponame,
        nametask: taskname,
      })
      _address = value0
    }

    return new Milestone(this.client, _address!)
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

  async getHackathonAppIndexCell(
    params: THackathonAppIndex & { repo_address: string },
  ) {
    const { value0 } = await this.runLocal(
      'getCellTagHack',
      {
        repo: params.repo_address,
        nametag: params.name,
        namecommit: params.commit.name,
        commit: params.commit.address,
        content: params.content,
        reponame: params.repo_name,
      },
      undefined,
      {
        useCachedBoc: true,
      },
    )
    return value0 as string
  }

  async getHackathonAppIndexCodeHash(repo_address: string) {
    const { value0 } = await this.runLocal(
      'getTagHackCode',
      { repo: repo_address },
      undefined,
      { useCachedBoc: true },
    )
    const { hash } = await this.client.boc.get_boc_hash({ boc: value0 })
    return hash
  }
}
