import { KeyPair, TonClient } from '@eversdk/core'
import { BaseContract } from '../../blockchain/contract'
import { UserProfile } from '../../blockchain/userprofile'
import { MAX_PARALLEL_READ, SYSTEM_TAG } from '../../constants'
import { GoshError } from '../../errors'
import { EDaoEventType } from '../../types/common.types'
import { executeByChunk, sleep } from '../../utils'
import { ETaskReward, TTaskGrant } from '../types/dao.types'
import { TGoshCommitTag } from '../types/repository.types'
import WalletABI from './abi/daowallet.abi.json'
import { SmvClient } from './smvclient'
import { SmvLocker } from './smvlocker'
import { GoshShapshot } from './snapshot'

export class DaoWallet extends BaseContract {
  constructor(client: TonClient, address: string, keys?: KeyPair) {
    super(client, WalletABI, address, { keys })
  }

  async isTurnedOn() {
    const details = await this.getDetails()
    return !!details.access
  }

  async isLimited() {
    const { _limited } = await this.runLocal('_limited', {})
    return _limited
  }

  async getDetails() {
    const data = await this.runLocal('getDetails', {})
    return {
      balance: {
        locked: parseInt(data.value0),
        pseudodao: parseInt(data.value1),
        pseudodaovote: parseInt(data.value2),
      },
      daoaddr: data.value3,
      rootpubaddr: data.value4,
      limit: parseInt(data.value5),
      pubaddr: data.value6,
      count: parseInt(data.value7),
      access: data.value8,
      tombstone: data.value9,
      expired: parseInt(data.value10),
    }
  }

  async getProfile() {
    const details = await this.getDetails()
    return new UserProfile(this.client, details.pubaddr)
  }

  async getSmvLocker() {
    const { tip3VotingLocker } = await this.runLocal(
      'tip3VotingLocker',
      {},
      undefined,
      {
        useCachedBoc: true,
      },
    )
    return new SmvLocker(this.client, tip3VotingLocker)
  }

  async getBalance() {
    const details = await this.getDetails()
    const balance = await this.smvLockerBalance()
    return {
      regular: details.balance.pseudodao,
      voting: balance.total,
      locked: Math.max(balance.locked, details.balance.locked),
      allowance: balance.total + details.balance.pseudodaovote,
    }
  }

  async setRepositoriesUpgraded(): Promise<void> {
    await this.run('setRepoUpgraded', { res: true })
  }

  async setTasksUpgraded(params: { cell?: boolean | undefined }) {
    const { cell } = params

    if (cell) {
      const { value0 } = await this.runLocal('getCellForRedeployedTask', {
        time: null,
      })
      return value0
    } else {
      await this.run('setRedeployedTask', {})
    }
  }

  async smvLockerBusy() {
    const locker = await this.getSmvLocker()
    const { lockerBusy } = await locker.runLocal('lockerBusy', {})
    return lockerBusy
  }

  async smvLockerBalance() {
    const locker = await this.getSmvLocker()
    const { m_tokenBalance } = await locker.runLocal('m_tokenBalance', {})
    const { votes_locked } = await locker.runLocal('votes_locked', {})
    return { total: parseInt(m_tokenBalance), locked: parseInt(votes_locked) }
  }

  async smvClientsCount() {
    const locker = await this.getSmvLocker()
    const { m_num_clients } = await locker.runLocal('m_num_clients', {})
    return parseInt(m_num_clients)
  }

  async smvLockTokens(amount: number) {
    await this.run('lockVoting', { amount })
  }

  async smvUnlockTokens(amount: number): Promise<void> {
    await this.run('unlockVoting', { amount })
  }

  async smvReleaseTokens() {
    const balance = await this.account.getBalance()
    if (parseInt(balance, 16) > 5000 * 10 ** 9) {
      await this.run('updateHead', {})
    }
  }

  async smvEventVotes(platformId: string) {
    const locker = await this.getSmvLocker()
    const { value0 } = await this.runLocal(
      'clientAddressForProposal',
      {
        _tip3VotingLocker: locker.address,
        _platform_id: platformId,
      },
      undefined,
      { useCachedBoc: true },
    )
    const client = new SmvClient(this.client, value0)
    if (!(await client.isDeployed())) {
      return 0
    }

    const { value0: locked } = await client.runLocal('amount_locked', {})
    return parseInt(locked)
  }

  async smvVote(params: {
    platformId: string
    choice: boolean
    amount: number
  }) {
    const { platformId, choice, amount } = params
    await this.run('voteFor', {
      platform_id: platformId,
      choice,
      amount,
      note: '',
      num_clients: await this.smvClientsCount(),
    })
  }

  async createDaoMember(params: {
    members: {
      profile: string
      allowance: number
      expired: number
    }[]
    daonames?: (string | null)[]
    comment?: string
    reviewers?: string[]
    cell?: boolean
    alone?: boolean
  }) {
    const {
      members = [],
      daonames = [],
      comment = '',
      reviewers = [],
      cell,
      alone,
    } = params

    const aloneParams = {
      pubaddr: members.map(({ profile, allowance, expired }) => ({
        member: profile,
        count: allowance,
        expired,
      })),
      dao: daonames,
    }
    const cellParams = { ...aloneParams, comment }

    if (cell) {
      const { value0 } = await this.runLocal(
        'getCellDeployWalletDao',
        cellParams,
      )
      return value0
    } else if (alone) {
      await this.run('AloneDeployWalletDao', aloneParams)
    } else {
      await this.run('startProposalForDeployWalletDao', {
        ...cellParams,
        reviewers,
        num_clients: await this.smvClientsCount(),
      })
    }
  }

  async deleteDaoMember(params: {
    profile: string[]
    comment?: string
    reviewers?: string[]
    cell?: boolean
  }) {
    const { profile, comment = '', reviewers = [], cell } = params

    const cellParams = { pubaddr: profile, comment }

    if (cell) {
      const { value0 } = await this.runLocal(
        'getCellDeleteWalletDao',
        cellParams,
      )
      return value0
    } else {
      const cell = await this.deleteDaoMember({ ...params, cell: true })
      await this.createSingleEvent({ cell, reviewers })
    }
  }

  async updateDaoMemberAllowance(params: {
    members: {
      profile: string
      increase: boolean
      amount: number
    }[]
    comment?: string
    reviewers?: string[]
    cell?: boolean | undefined
  }) {
    const { members, comment = '', reviewers = [], cell } = params

    const cellParams = {
      pubaddr: members.map(({ profile }) => profile),
      increase: members.map(({ increase }) => increase),
      grant: members.map(({ amount }) => amount),
      comment,
    }

    if (cell) {
      const { value0 } = await this.runLocal(
        'getCellChangeAllowance',
        cellParams,
      )
      return value0
    } else {
      const cell = await this.updateDaoMemberAllowance({
        ...params,
        cell: true,
      })
      await this.createSingleEvent({ cell, reviewers })
    }
  }

  async createRepository(params: {
    name: string
    description?: string
    previous?: {
      addr: string
      version: string
    }
    comment?: string
    reviewers?: string[]
    alone?: boolean
    cell?: boolean
  }) {
    const {
      name,
      previous,
      comment = '',
      description = '',
      reviewers = [],
      alone,
      cell,
    } = params

    const deployParams = {
      nameRepo: name.toLowerCase(),
      descr: description,
      previous: previous || null,
    }
    const cellParams = { ...deployParams, comment }

    if (cell) {
      const { value0 } = await this.runLocal('getCellDeployRepo', cellParams)
      return value0
    } else if (alone) {
      await this.run('AloneDeployRepository', deployParams)
    } else {
      const cell = await this.createRepository({ ...params, cell: true })
      await this.createSingleEvent({ cell, reviewers })
    }
  }

  async createCommitTag(tag: TGoshCommitTag) {
    await this.run('deployTag', {
      repoName: tag.reponame,
      nametag: tag.name,
      nameCommit: tag.commit.name,
      content: tag.content,
      commit: tag.commit.address,
    })
  }

  async deleteCommitTag(params: { reponame: string; tagname: string }) {
    const { reponame, tagname } = params
    await this.run('deleteTag', { repoName: reponame, nametag: tagname })
  }

  async sendDaoEventReview(params: { eventaddr: string; decision: boolean }) {
    const { eventaddr, decision } = params

    const fn = decision ? 'acceptReviewer' : 'rejectReviewer'
    await this.run(fn, { propAddress: eventaddr })
  }

  async upgradeDao(params: {
    version: string
    description?: string
    reviewers?: string[]
    cell?: boolean
  }) {
    const { version, reviewers = [], cell } = params

    const comment = params.description ?? `Upgrade DAO to version ${version}`
    const cellParams = {
      newversion: version,
      description: comment,
      comment,
    }

    if (cell) {
      const { value0 } = await this.runLocal('getCellSetUpgrade', cellParams)
      return value0
    } else {
      const cell = await this.upgradeDao({ ...params, cell: true })
      await this.createSingleEvent({ cell, reviewers })
    }
  }

  async updateDaoAskMembership(params: {
    decision: boolean
    comment?: string
    reviewers?: string[]
    cell?: boolean
  }) {
    const { decision, comment = '', reviewers = [], cell } = params

    const cellParams = { res: decision, comment }

    if (cell) {
      const { value0 } = await this.runLocal(
        'getCellSetAbilityInvite',
        cellParams,
      )
      return value0
    } else {
      const cell = await this.updateDaoAskMembership({ ...params, cell: true })
      await this.createSingleEvent({ cell, reviewers })
    }
  }

  async updateDaoEventShowProgress(params: {
    decision: boolean
    comment?: string
    reviewers?: string[]
    cell?: boolean
  }) {
    const { decision, comment = '', reviewers = [], cell } = params

    const cellParams = { res: !decision, comment }

    if (cell) {
      const { value0 } = await this.runLocal(
        'getCellSetHideVotingResult',
        cellParams,
      )
      return value0
    } else {
      const cell = await this.updateDaoEventShowProgress({
        ...params,
        cell: true,
      })
      await this.createSingleEvent({ cell, reviewers })
    }
  }

  async updateDaoEventAllowDiscussion(params: {
    allow: boolean
    comment?: string
    reviewers?: string[]
    cell?: boolean
  }) {
    const { allow, comment = '', reviewers = [], cell } = params

    const cellParams = { res: allow, comment }

    if (cell) {
      const { value0 } = await this.runLocal(
        'getCellSetAllowDiscussion',
        cellParams,
      )
      return value0
    } else {
      const cell = await this.updateDaoEventAllowDiscussion({
        ...params,
        cell: true,
      })
      await this.createSingleEvent({ cell, reviewers })
    }
  }

  async mintDaoTokens(params: {
    amount: number
    comment?: string
    reviewers?: string[]
    alone?: boolean
    cell?: boolean
  }) {
    const { amount, comment = '', reviewers = [], alone, cell } = params

    const aloneParams = { token: amount }
    const cellParams = { ...aloneParams, comment }

    if (cell) {
      const { value0 } = await this.runLocal('getCellMintToken', cellParams)
      return value0
    } else if (alone) {
      await this.run('AloneMintDaoReserve', aloneParams)
    } else {
      const cell = await this.mintDaoTokens({ ...params, cell: true })
      await this.createSingleEvent({ cell, reviewers })
    }
  }

  async disableMintDaoTokens(params: {
    comment?: string
    reviewers?: string[]
    alone?: boolean
    cell?: boolean
  }) {
    const { comment = '', reviewers = [], alone, cell } = params

    const cellParams = { comment }

    if (cell) {
      const { value0 } = await this.runLocal('getCellAllowMint', cellParams)
      return value0
    } else if (alone) {
      await this.run('AloneNotAllowMint', {})
    } else {
      const cell = await this.disableMintDaoTokens({ ...params, cell: true })
      await this.createSingleEvent({ cell, reviewers })
    }
  }

  async addDaoVotingTokens(params: {
    profile: string
    amount: number
    comment?: string
    reviewers?: string[]
    alone?: boolean | undefined
    cell?: boolean | undefined
  }) {
    const {
      profile,
      amount,
      comment = '',
      reviewers = [],
      alone,
      cell,
    } = params

    const cellParams = { pubaddr: profile, token: amount, comment }

    if (cell) {
      const { value0 } = await this.runLocal('getCellAddVoteToken', cellParams)
      return value0
    } else if (alone) {
      await this.run('AloneAddVoteTokenDao', { grant: amount })
    } else {
      const cell = await this.addDaoVotingTokens({ ...params, cell: true })
      await this.createSingleEvent({ cell, reviewers })
    }
  }

  async addDaoRegularTokens(params: {
    profile: string
    amount: number
    comment?: string
    reviewers?: string[]
    alone?: boolean | undefined
    cell?: boolean | undefined
  }) {
    const {
      profile,
      amount,
      comment = '',
      reviewers = [],
      alone,
      cell,
    } = params

    const cellParams = { pubaddr: profile, token: amount, comment }

    if (cell) {
      const { value0 } = await this.runLocal(
        'getCellAddRegularToken',
        cellParams,
      )
      return value0
    } else if (alone) {
      await this.run('AloneAddTokenDao', { grant: amount })
    } else {
      const cell = await this.addDaoRegularTokens({ ...params, cell: true })
      await this.createSingleEvent({ cell, reviewers })
    }
  }

  async sendTokensToDaoReserve(amount: number) {
    await this.run('sendTokenToDaoReserve', { grant: amount })
  }

  async sendTokensToDaoWallet(profile: string, amount: number): Promise<void> {
    await this.run('sendToken', { pubaddr: profile, grant: amount })
  }

  async sendTokensToUpgradedDao(amount: number, version: string) {
    await this.run('sendTokenToNewVersion', {
      grant: amount,
      newversion: version,
    })
  }

  async createDaoTag(params: {
    tags: string[]
    comment?: string
    reviewers?: string[]
    alone?: boolean
    cell?: boolean
  }) {
    const { tags, comment = '', reviewers = [], alone, cell } = params

    const clean = tags
      .filter((item) => !!item.trim().length)
      .map((item) => {
        return item.startsWith('#') ? item.slice(1) : item
      })
    const aloneParams = { tag: clean }
    const cellParams = { ...aloneParams, comment }

    if (cell) {
      const { value0 } = await this.runLocal('getCellAddDaoTag', cellParams)
      return value0
    } else if (alone) {
      await this.run('AloneDeployDaoTag', aloneParams)
    } else {
      const cell = await this.createDaoTag({ ...params, cell: true })
      await this.createSingleEvent({ cell, reviewers })
    }
  }

  async deleteDaoTag(params: {
    tags: string[]
    comment?: string
    reviewers?: string[]
    cell?: boolean
  }) {
    const { tags, comment = '', reviewers = [], cell } = params

    const clean = tags
      .filter((item) => !!item.trim().length)
      .map((item) => {
        return item.startsWith('#') ? item.slice(1) : item
      })
    const cellParams = { tag: clean, comment }

    if (cell) {
      const { value0 } = await this.runLocal('getCellDestroyDaoTag', cellParams)
      return value0
    } else {
      const cell = await this.deleteDaoTag({ ...params, cell: true })
      await this.createSingleEvent({ cell, reviewers })
    }
  }

  async createTask(params: {
    reponame: string
    taskname: string
    config: TTaskGrant
    tags?: string[]
    reviewers?: string[]
    comment?: string
    cell?: boolean
  }) {
    const {
      reponame,
      taskname,
      config,
      tags = [],
      comment = '',
      reviewers = [],
      cell,
    } = params

    const tagList = [SYSTEM_TAG, ...tags]
    const cellParams = {
      repoName: reponame,
      taskName: taskname,
      grant: config,
      tag: tagList,
      comment,
    }

    if (cell) {
      const { value0 } = await this.runLocal('getCellTaskDeploy', cellParams)
      return value0
    } else {
      const cell = await this.createTask({ ...params, cell: true })
      await this.createSingleEvent({ cell, reviewers })
    }
  }

  async deleteTask(params: {
    reponame: string
    taskname: string
    comment?: string
    reviewers?: string[]
    cell?: boolean
  }) {
    const { reponame, taskname, comment = '', reviewers = [], cell } = params

    const cellParams = { repoName: reponame, taskName: taskname, comment }

    if (cell) {
      const { value0 } = await this.runLocal('getCellTaskDestroy', cellParams)
      return value0
    } else {
      const cell = await this.deleteTask({ ...params, cell: true })
      await this.createSingleEvent({ cell, reviewers })
    }
  }

  async receiveTaskReward(params: {
    reponame: string
    taskname: string
    type: ETaskReward
  }) {
    const { reponame, taskname, type } = params
    await this.run('askGrantToken', {
      repoName: reponame,
      nametask: taskname,
      typegrant: type,
    })
  }

  async transferTask(params: { accountData: any; reponame: string }) {
    const { accountData, reponame } = params

    const constructorParams = {
      nametask: accountData._nametask,
      repoName: reponame,
      ready: accountData._ready,
      candidates: accountData._candidates.map((item: any) => ({
        ...item,
        daoMembers: {},
      })),
      grant: accountData._grant,
      hashtag: accountData._hashtag,
      indexFinal: accountData._indexFinal,
      locktime: accountData._locktime,
      fullAssign: accountData._fullAssign,
      fullReview: accountData._fullReview,
      fullManager: accountData._fullManager,
      assigners: accountData._assigners,
      reviewers: accountData._reviewers,
      managers: accountData._managers,
      assignfull: accountData._assignfull,
      reviewfull: accountData._reviewfull,
      managerfull: accountData._managerfull,
      assigncomplete: accountData._assigncomplete,
      reviewcomplete: accountData._reviewcomplete,
      managercomplete: accountData._managercomplete,
      allassign: accountData._allassign,
      allreview: accountData._allreview,
      allmanager: accountData._allmanager,
      lastassign: accountData._lastassign,
      lastreview: accountData._lastreview,
      lastmanager: accountData._lastmanager,
      balance: accountData._balance,
    }

    const { value0: cell } = await this.runLocal(
      'getCellForTask',
      constructorParams,
    )
    const { value0 } = await this.runLocal('getCellForRedeployTask', {
      reponame: constructorParams.repoName,
      nametask: constructorParams.nametask,
      hashtag: constructorParams.hashtag,
      data: cell,
      time: null,
    })
    return value0
  }

  async upgradeTask(params: {
    reponame: string
    taskname: string
    taskprev: {
      address: string
      version: string
    }
    tags: string[]
    comment?: string
    reviewers?: string[]
    cell?: boolean | undefined
  }) {
    const {
      reponame,
      taskname,
      taskprev,
      tags,
      comment = '',
      reviewers = [],
      cell,
    } = params

    const cellParams = {
      reponame,
      nametask: taskname,
      oldversion: taskprev.version,
      oldtask: taskprev.address,
      hashtag: tags,
      comment,
    }

    if (cell) {
      const { value0 } = await this.runLocal(
        'getCellForTaskUpgrade',
        cellParams,
      )
      return value0
    } else {
      const cell = await this.upgradeTask({ ...params, cell: true })
      await this.createSingleEvent({ cell, reviewers })
    }
  }

  async createRepositoryTag(params: {
    reponame: string
    tags: string[]
    reviewers?: string[]
    comment?: string
    cell?: boolean
  }) {
    const { reponame, tags, comment = '', reviewers = [], cell } = params

    const cellParams = { repo: reponame, tag: tags, comment }

    if (cell) {
      const { value0 } = await this.runLocal('getCellAddRepoTag', cellParams)
      return value0
    } else {
      const cell = await this.createRepositoryTag({ ...params, cell: true })
      await this.createSingleEvent({ cell, reviewers })
    }
  }

  async deleteRepositoryTag(params: {
    reponame: string
    tags: string[]
    reviewers?: string[]
    comment?: string
    cell?: boolean
  }) {
    const { reponame, tags, comment = '', reviewers = [], cell } = params

    const cellParams = { repo: reponame, tag: tags, comment }

    if (cell) {
      const { value0 } = await this.runLocal(
        'getCellDestroyRepoTag',
        cellParams,
      )
      return value0
    } else {
      const cell = await this.deleteRepositoryTag({ ...params, cell: true })
      await this.createSingleEvent({ cell, reviewers })
    }
  }

  async updateRepositoryDescription(params: {
    reponame: string
    description: string
    reviewers?: string[]
    comment?: string
    cell?: boolean
  }) {
    const { reponame, description, comment = '', reviewers = [], cell } = params

    const cellParams = { repoName: reponame, descr: description, comment }

    if (cell) {
      const { value0 } = await this.runLocal(
        'getCellChangeDescription',
        cellParams,
      )
      return value0
    } else {
      const cell = await this.updateRepositoryDescription({
        ...params,
        cell: true,
      })
      await this.createSingleEvent({ cell, reviewers })
    }
  }

  async receiveTaskRewardAsDao(params: {
    wallet: string
    reponame: string
    taskname: string
    comment?: string
    reviewers?: string[]
    cell?: boolean
  }) {
    const {
      wallet,
      reponame,
      taskname,
      comment = '',
      reviewers = [],
      cell,
    } = params

    const cellParams = {
      wallet,
      repoName: reponame,
      taskName: taskname,
      comment,
    }

    if (cell) {
      const { value0 } = await this.runLocal(
        'getCellForDaoAskGrant',
        cellParams,
      )
      return value0
    } else {
      const cell = await this.receiveTaskRewardAsDao({ ...params, cell: true })
      await this.createSingleEvent({ cell, reviewers })
    }
  }

  async upgradeVersionController(params: {
    code: string
    data: string
    comment?: string
    reviewers?: string[]
  }) {
    const { code, data, comment = '', reviewers = [] } = params

    const cellParams = { UpgradeCode: code, cell: data, comment }
    await this.run('startProposalForUpgradeVersionController', {
      ...cellParams,
      reviewers,
      num_clients: await this.smvClientsCount(),
    })
  }

  async createSingleEvent(params: { cell: string; reviewers?: string[] }) {
    const { cell, reviewers = [] } = params

    await this.run('startOneProposal', {
      proposal: cell,
      reviewers,
      num_clients: await this.smvClientsCount(),
    })
  }

  async createMultiEvent(params: {
    proposals: { type: EDaoEventType; params: any }[]
    comment?: string
    reviewers?: string[]
  }): Promise<void> {
    const { proposals, comment, reviewers = [] } = params

    // Prepare cells
    const { cell, count } = await this.createMultiEventData(proposals)

    // Create proposal
    await this.run('startMultiProposal', {
      number: count,
      proposals: cell,
      reviewers,
      comment,
      num_clients: await this.smvClientsCount(),
    })
  }

  async getSnapshot(params: {
    address?: string
    data?: { commit_name: string; repo_addr: string; filename: string }
  }) {
    const { address, data } = params

    if (!address && !data) {
      throw new GoshError('Value error', 'Data or address not passed')
    }

    let _address = address
    if (!_address) {
      const { commit_name, repo_addr, filename } = data!
      const { value0 } = await this.runLocal(
        'getSnapshotAddr',
        { commitSha: commit_name, repo: repo_addr, name: filename },
        undefined,
        { useCachedBoc: true },
      )
      _address = value0
    }

    return new GoshShapshot(this.client, _address!)
  }

  async createSnapshot(params: {
    commit_name: string
    repo_addr: string
    filename: string
    content: string
    ipfs_url?: string
    is_pin: boolean
  }) {
    const { commit_name, repo_addr, filename, content, ipfs_url, is_pin } =
      params
    await this.run('deployNewSnapshot', {
      commitsha: commit_name,
      repo: repo_addr,
      name: filename,
      snapshotdata: content,
      snapshotipfs: ipfs_url,
      isPin: is_pin,
    })
  }

  async transferTokensAsDaoAuto(params: { dst_wallet: string }) {
    await this.run('daoSendTokenToNewVersionAuto', {
      wallet: params.dst_wallet,
    })
  }

  /**
   * Private methods
   */
  private async createMultiEventData(
    proposals: { type: EDaoEventType; params: any }[],
  ) {
    // Prepare cells
    const cells = await executeByChunk(
      proposals,
      MAX_PARALLEL_READ,
      async ({ type, params }) => {
        if (type === EDaoEventType.REPO_CREATE) {
          return await this.createRepository({
            ...params,
            alone: false,
            cell: true,
          })
        }
        if (type === EDaoEventType.REPO_TAG_ADD) {
          return await this.createRepositoryTag({ ...params, cell: true })
        }
        if (type === EDaoEventType.REPO_TAG_REMOVE) {
          return await this.deleteRepositoryTag({ ...params, cell: true })
        }
        if (type === EDaoEventType.REPO_UPDATE_DESCRIPTION) {
          return await this.updateRepositoryDescription({
            ...params,
            cell: true,
          })
        }
        if (type === EDaoEventType.DAO_MEMBER_ADD) {
          return await this.createDaoMember({
            ...params,
            alone: false,
            cell: true,
          })
        }
        if (type === EDaoEventType.DAO_MEMBER_DELETE) {
          return await this.deleteDaoMember({
            ...params,
            alone: false,
            cell: true,
          })
        }
        if (type === EDaoEventType.DAO_UPGRADE) {
          return await this.upgradeDao({ ...params, cell: true })
        }
        if (type === EDaoEventType.DAO_TOKEN_VOTING_ADD) {
          return await this.addDaoVotingTokens({
            ...params,
            alone: false,
            cell: true,
          })
        }
        if (type === EDaoEventType.DAO_TOKEN_REGULAR_ADD) {
          return await this.addDaoRegularTokens({
            ...params,
            alone: false,
            cell: true,
          })
        }
        if (type === EDaoEventType.DAO_TOKEN_MINT) {
          return await this.mintDaoTokens({
            ...params,
            alone: false,
            cell: true,
          })
        }
        if (type === EDaoEventType.DAO_TOKEN_MINT_DISABLE) {
          return await this.disableMintDaoTokens({
            ...params,
            alone: false,
            cell: true,
          })
        }
        if (type === EDaoEventType.DAO_TAG_ADD) {
          return await this.createDaoTag({
            ...params,
            alone: false,
            cell: true,
          })
        }
        if (type === EDaoEventType.DAO_TAG_REMOVE) {
          return await this.deleteDaoTag({
            ...params,
            alone: false,
            cell: true,
          })
        }
        if (type === EDaoEventType.DAO_ALLOWANCE_CHANGE) {
          return await this.updateDaoMemberAllowance({ ...params, cell: true })
        }
        if (type === EDaoEventType.DAO_EVENT_ALLOW_DISCUSSION) {
          return await this.updateDaoEventAllowDiscussion({
            ...params,
            cell: true,
          })
        }
        if (type === EDaoEventType.DAO_EVENT_HIDE_PROGRESS) {
          return await this.updateDaoEventShowProgress({
            ...params,
            alone: false,
            cell: true,
          })
        }
        if (type === EDaoEventType.DAO_ASK_MEMBERSHIP_ALLOWANCE) {
          return await this.updateDaoAskMembership({
            ...params,
            alone: false,
            cell: true,
          })
        }
        if (type === EDaoEventType.TASK_CREATE) {
          return await this.createTask({ ...params, cell: true })
        }
        if (type === EDaoEventType.TASK_DELETE) {
          return await this.deleteTask({ ...params, cell: true })
        }
        if (type === EDaoEventType.DELAY) {
          const { value0 } = await this.runLocal('getCellDelay', {})
          return value0
        }
        if (type === EDaoEventType.TASK_REDEPLOY) {
          return await this.transferTask(params)
        }
        if (type === EDaoEventType.TASK_UPGRADE) {
          return await this.upgradeTask({ ...params, cell: true })
        }
        if (type === EDaoEventType.TASK_REDEPLOYED) {
          return await this.setTasksUpgraded({ ...params, cell: true })
        }
        return null
      },
    )

    // Compose cells
    const clean = cells.filter((cell) => typeof cell === 'string')
    const count = clean.length
    for (let i = clean.length - 1; i > 0; i--) {
      const cellA = clean[i - 1]
      const cellB = clean[i]
      const { value0 } = await this.runLocal('AddCell', {
        data1: cellA,
        data2: cellB,
      })
      clean.splice(i - 1, 2, value0)
      await sleep(50)
    }

    return { cell: clean[0], count }
  }
}
