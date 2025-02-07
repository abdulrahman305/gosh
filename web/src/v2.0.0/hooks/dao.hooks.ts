import { useCallback, useEffect, useState } from 'react'
import _ from 'lodash'
import { useProfile, useUser } from './user.hooks'
import { EGoshError, GoshError } from '../../errors'
import { AppConfig } from '../../appconfig'
import { getSystemContract } from '../blockchain/helpers'
import { supabase } from '../../supabase'
import { Buffer } from 'buffer'
import {
  executeByChunk,
  setLockableInterval,
  sleep,
  splitByChunk,
  whileFinite,
} from '../../utils'
import {
  DISABLED_VERSIONS,
  MAX_PARALLEL_READ,
  MAX_PARALLEL_WRITE,
  SYSTEM_TAG,
} from '../../constants'
import { useRecoilState, useRecoilValue, useSetRecoilState } from 'recoil'
import {
  daoDetailsSelector,
  daoEventListSelector,
  daoEventSelector,
  daoInviteListAtom,
  daoMemberListSelector,
  daoMemberSelector,
  daoTaskListSelector,
  daoTaskSelector,
  userDaoListAtom,
} from '../store/dao.state'
import {
  ETaskReward,
  TDaoDetailsMemberItem,
  TDaoEventDetails,
  TDaoInviteListItem,
  TDaoListItem,
  TDaoMemberListItem,
  TTaskDetails,
  TTaskGrant,
  TTaskGrantPair,
} from '../types/dao.types'
import { Dao } from '../blockchain/dao'
import { UserProfile } from '../../blockchain/userprofile'
import { DaoWallet } from '../blockchain/daowallet'
import { EDaoEventType, TToastStatus } from '../../types/common.types'
import { getAllAccounts, getPaginatedAccounts } from '../../blockchain/utils'
import { DaoEvent } from '../blockchain/daoevent'
import { GoshAdapterFactory } from 'react-gosh'
import { TSystemContract } from '../../types/blockchain.types'
import { TGoshCommitTag } from '../types/repository.types'
import { GoshRepository } from '../blockchain/repository'
import { EDaoInviteStatus } from '../types/onboarding.types'
import { Task } from '../blockchain/task'
import { AggregationFn } from '@eversdk/core'
import { appContextAtom, appToastStatusSelector } from '../../store/app.state'

export function useCreateDao() {
  const profile = useProfile()
  const { user } = useUser()
  const setUserDaoList = useSetRecoilState(userDaoListAtom)
  const [status, setStatus] = useRecoilState(appToastStatusSelector('__createdao'))

  const createDao = async (params: {
    name: string
    tags: string[]
    supply: number
    isMintOn: boolean
    description?: string
  }) => {
    const { name, tags, supply, isMintOn, description } = params

    try {
      const sc = getSystemContract()

      if (!profile || !user.keys) {
        throw new GoshError('Access error', {
          message: 'You might not be authenticated',
        })
      }

      // Create DAO
      setStatus((state) => ({ ...state, type: 'pending', data: 'Create DAO' }))
      const dao = (await profile.createDao(sc, name, [profile.address])) as Dao
      const version = await dao.getVersion()

      // Authorize DAO wallet
      setStatus((state) => ({ ...state, type: 'pending', data: 'Authorize DAO' }))
      const wallet = (await dao.getMemberWallet({
        data: { profile: profile.address },
        keys: user.keys,
      })) as DaoWallet
      await profile.turnOn(wallet.address, user.keys.public)

      // Mint tokens
      if (supply > 20) {
        setStatus((state) => ({
          ...state,
          type: 'pending',
          data: 'Minting tokens',
        }))
        await wallet.mintDaoTokens({ amount: supply - 20, alone: true })
      }

      // Update minting policy
      if (!isMintOn) {
        setStatus((state) => ({
          ...state,
          type: 'pending',
          data: 'Disable minting',
        }))
        await wallet.disableMintDaoTokens({ alone: true })
      }

      // Create DAO tags
      if (tags.length) {
        setStatus((state) => ({
          ...state,
          type: 'pending',
          data: 'Create DAO tags',
        }))
        await wallet.createDaoTag({ tags, alone: true })
      }

      // Create DAO system repository
      setStatus((state) => ({
        ...state,
        type: 'pending',
        data: 'Create DAO system repository',
      }))
      const repository = (await sc.getRepository({
        path: `${name}/_index`,
      })) as GoshRepository
      await wallet.createRepository({
        name: '_index',
        description: 'DAO system repository',
        alone: true,
      })
      const wait = await whileFinite(async () => {
        return await repository.isDeployed()
      })
      if (!wait) {
        throw new GoshError('Timeout error', 'Create DAO reposirory timeout reached')
      }

      // Push description blob to DAO service repository
      if (description) {
        setStatus((state) => ({
          ...state,
          type: 'pending',
          data: 'Update DAO description',
        }))
        // TODO: Update this part after git part refactor
        const _gosh = GoshAdapterFactory.create(version)
        await _gosh.setAuth(user.username!, user.keys)
        const _dao = await _gosh.getDao({ address: dao.address, useAuth: true })
        const _repo = await _dao.getRepository({ address: repository.address })
        const blobs = [
          {
            treepath: ['', 'description.txt'],
            original: '',
            modified: description,
          },
        ]
        await _repo.push('main', blobs, 'Initial commit', false, {})
        // TODO: /Update this part after git part refactor
      }

      // Set upgrade repos flag
      setStatus((state) => ({
        ...state,
        type: 'pending',
        data: 'Update DAO flags',
      }))
      await wallet.setRepositoriesUpgraded()

      setStatus((state) => ({
        ...state,
        type: 'success',
        data: { title: 'Create DAO', content: 'DAO created' },
      }))
      setUserDaoList((state) => ({
        ...state,
        items: [
          {
            account: dao as Dao,
            address: dao.address,
            name,
            version,
            supply,
            members: 1,
          },
          ...state.items,
        ],
      }))
    } catch (e: any) {
      setStatus((state) => ({ ...state, type: 'error', data: e }))
      throw e
    }
  }

  return { createDao, status }
}

export function useUserDaoList(params: { count?: number; initialize?: boolean } = {}) {
  const { count = 10, initialize } = params
  const { user } = useUser()
  const profile = useProfile()
  const [data, setData] = useRecoilState(userDaoListAtom)

  const getOnboardingItems = async (username: string) => {
    const { data, error } = await supabase.client
      .from('users')
      .select(`*, github (updated_at, gosh_url)`)
      .eq('gosh_username', username)
    if (error) {
      throw new GoshError('Get onboarding data', error.message)
    }
    if (!data?.length) {
      return []
    }

    const imported: { [name: string]: string[] } = {}
    const row = data[0]
    for (const item of row.github) {
      if (item.updated_at) {
        continue
      }

      const splitted = item.gosh_url.split('/')
      const dao = splitted[splitted.length - 2]
      const repo = splitted[splitted.length - 1]
      if (Object.keys(imported).indexOf(dao) < 0) {
        imported[dao] = []
      }
      if (imported[dao].indexOf(repo) < 0) {
        imported[dao].push(repo)
      }
    }

    return Object.keys(imported).map((key) => ({
      name: key,
      repos: imported[key],
    }))
  }

  const getBlockchainItems = async (params: {
    profile: UserProfile
    limit: number
    cursor?: string
    _items?: TDaoListItem[]
  }): Promise<{ items: TDaoListItem[]; cursor?: string; hasNext?: boolean }> => {
    const { profile, limit, cursor, _items = [] } = params
    const {
      messages,
      cursor: _cursor,
      hasNext,
    } = await profile.getMessages(
      {
        msgType: ['IntIn'],
        node: ['created_at'],
        cursor,
        allow_latest_inconsistent_data: true,
      },
      true,
    )

    const items = await executeByChunk(
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
        const sc = AppConfig.goshroot.getSystemContract(ver)
        const account = (await sc.getDao({ address: goshdao })) as Dao
        const members = await account.getMembers()
        return {
          account,
          name: await account.getName(),
          address: goshdao,
          version: ver,
          supply: _.sum(members.map(({ allowance }) => allowance)),
          members: members.length,
        }
      },
    )

    // Avoid duplicates of the same DAO by unique name
    for (const item of items) {
      if (_items.findIndex((_item) => _item.name === item.name) < 0) {
        _items.push(item)
      }
    }

    if (_items.length < limit && hasNext) {
      return await getBlockchainItems({ profile, limit, cursor: _cursor, _items })
    }
    return { items: _items, cursor: _cursor, hasNext }
  }

  const getNext = useCallback(async () => {
    try {
      setData((state) => ({ ...state, isFetching: true }))
      const blockchain = await getBlockchainItems({
        profile: profile!,
        limit: data.items.length + count,
        cursor: data.cursor,
        _items: [...data.items],
      })
      setData((state) => ({
        ...state,
        items: blockchain.items,
        cursor: blockchain.cursor,
        hasNext: blockchain.hasNext,
      }))
    } catch (e: any) {
      throw e
    } finally {
      setData((state) => ({ ...state, isFetching: false }))
    }
  }, [profile, data.cursor])

  const getUserDaoList = useCallback(async () => {
    try {
      setData((state) => ({ ...state, isFetching: true }))
      if (!profile || !user.username) {
        throw new GoshError(EGoshError.PROFILE_UNDEFINED)
      }

      // Get onboarding items
      const onboarding = (await getOnboardingItems(user.username)).map((item) => ({
        account: null,
        name: item.name,
        address: '',
        version: '',
        supply: -1,
        members: -1,
        onboarding: item.repos,
      }))

      /**
       * Get blockchain items
       * If there are items in state limit should be
       * equal to `items.length` otherwise `count` per page
       */
      const blockchain = await getBlockchainItems({
        profile,
        limit: data.items.length || count,
      })

      // Compose all items together
      const different = _.differenceWith(onboarding, blockchain.items, (a, b) => {
        return a.name === b.name
      })
      const composed = [
        ...different,
        ...blockchain.items.map((item) => {
          const gh = onboarding.find((ghitem) => ghitem.name === item.name)
          if (gh) {
            return { ...item, onboarding: gh.onboarding }
          }
          return item
        }),
      ]

      // Update state
      setData((state) => {
        const different = _.differenceWith(composed, state.items, (a, b) => {
          return a.name === b.name
        })
        const intersect = _.intersectionWith(composed, state.items, (a, b) => {
          return a.name === b.name
        })
        return {
          ...state,
          items: [...state.items, ...different].map((item) => {
            const found = intersect.find((_item) => _item.name === item.name)
            return found || item
          }),
          cursor: blockchain.cursor,
          hasNext: blockchain.hasNext,
        }
      })
    } catch (e: any) {
      setData((state) => ({ ...state, error: e }))
    } finally {
      setData((state) => ({ ...state, isFetching: false }))
    }
  }, [profile])

  useEffect(() => {
    if (initialize) {
      getUserDaoList()
    }
  }, [getUserDaoList, initialize])

  return {
    ...data,
    items: [...data.items].sort((a, b) => (a.name > b.name ? 1 : -1)),
    isEmpty: !data.isFetching && !data.items.length,
    getNext,
  }
}

export function useDao(params: { initialize?: boolean; subscribe?: boolean } = {}) {
  const { initialize, subscribe } = params
  const { daoname } = useRecoilValue(appContextAtom)
  const [data, setData] = useRecoilState(daoDetailsSelector(daoname))

  const getDao = useCallback(async () => {
    try {
      if (!daoname) {
        return
      }

      setData((state) => ({ ...state, isFetching: true }))
      const sc = getSystemContract()
      const dao = await sc.getDao({ name: daoname })
      if (!(await dao.isDeployed())) {
        throw new GoshError('DAO does not exist', { name: daoname })
      }
      const version = await dao.getVersion()
      const repository = await sc.getRepository({
        path: `${daoname}/_index`,
      })

      // TODO: Remove this after git part refactor
      const _gosh = GoshAdapterFactory.create(version)
      const _adapter = await _gosh.getDao({ address: dao.address })
      // TODO: /Remove this after git part refactor

      setData((state) => ({
        ...state,
        details: {
          ...state.details,
          account: dao as Dao,
          _adapter,
          name: daoname,
          address: dao.address,
          version,
          repository,
        },
        error: undefined,
      }))
      getDetails({ dao, repository })
    } catch (e) {
      setData((state) => ({ ...state, error: e }))
      throw e
    } finally {
      setData((state) => ({ ...state, isFetching: false }))
    }
  }, [daoname])

  const getDetails = async (params: { dao: Dao; repository: GoshRepository }) => {
    const { dao, repository } = params

    if (!dao) {
      return
    }

    try {
      setData((state) => ({ ...state, isFetchingData: true }))

      const details = await dao.getDetails()
      const members = await dao.getMembers(details.wallets)
      const { summary, description } = await getDescription(repository)
      const tasks = await getTaskCount(dao)

      setData((state) => ({
        ...state,
        details: {
          ...state.details,
          members,
          supply: {
            reserve: parseInt(details.reserve),
            voting: parseInt(details.allbalance),
            total: parseInt(details.totalsupply),
          },
          owner: details.pubaddr,
          tags: Object.values(details.hashtag),
          tasks,
          summary,
          description,
          isMintOn: details.allowMint,
          isAskMembershipOn: details.abilityInvite,
          isEventDiscussionOn: details.allow_discussion_on_proposals,
          isEventProgressOn: !details.hide_voting_results,
          isRepoUpgraded: details.isRepoUpgraded,
          isUpgraded: details.isRepoUpgraded,
        },
      }))
    } catch (e: any) {
      console.error(e.message)
    } finally {
      setData((state) => ({ ...state, isFetchingData: false }))
    }
  }

  const getDescription = async (repository: GoshRepository) => {
    if (!(await repository.isDeployed())) {
      return { summary: '', description: '' }
    }

    // Get DAO description
    const [summary, description] = await Promise.all(
      ['description.txt', 'README.md'].map(async (filename) => {
        const snapshot = await repository.getSnapshot({
          data: { branch: 'main', filename },
        })
        if (await snapshot.isDeployed()) {
          const result = await snapshot.getContent()
          if (!Buffer.isBuffer(result.content)) {
            return result.content
          }
        }
        return ''
      }),
    )
    return { summary, description }
  }

  const getTaskCount = async (dao: Dao) => {
    const codeHash = await getSystemContract().getDaoTaskTagCodeHash(
      dao.address,
      SYSTEM_TAG,
    )
    const { values } = await dao.account.client.net.aggregate_collection({
      collection: 'accounts',
      filter: { code_hash: { eq: codeHash } },
      fields: [{ field: 'id', fn: AggregationFn.COUNT }],
    })
    return parseInt(values[0])
  }

  useEffect(() => {
    if (initialize) {
      getDao()
    }
  }, [getDao, initialize])

  useEffect(() => {
    if (!subscribe || !data.details.address) {
      return
    }

    const interval = setLockableInterval(async () => {
      await getDetails({
        dao: data.details.account!,
        repository: data.details.repository!,
      })
    }, 15000)

    return () => {
      clearInterval(interval)
    }
  }, [subscribe, data.details.address])

  return data
}

export function useDaoMember(params: { initialize?: boolean; subscribe?: boolean } = {}) {
  const { initialize, subscribe } = params
  const { user } = useUser()
  const { details: dao } = useDao()
  const [data, setData] = useRecoilState(daoMemberSelector(dao.name))
  const setStatus0 = useSetRecoilState(appToastStatusSelector('__activatedaowallet'))

  const activate = async (profile: UserProfile, wallet: DaoWallet) => {
    try {
      // Deploy limited wallet
      if (!(await wallet.isDeployed())) {
        setStatus0((state) => ({
          ...state,
          type: 'pending',
          data: 'Create DAO wallet',
        }))

        await dao.account!.createLimitedWallet(profile.address)
        const wait = await whileFinite(async () => {
          return await wallet.isDeployed()
        })
        if (!wait) {
          throw new GoshError('Timeout error', 'Create DAO wallet timeout reached')
        }
      }

      // Activate wallet
      if (!(await wallet.isTurnedOn())) {
        setStatus0((state) => ({
          ...state,
          type: 'pending',
          data: 'Activating DAO wallet',
        }))
        await profile.turnOn(wallet.address, user.keys!.public)
      }

      setStatus0((state) => ({ ...state, type: 'dismiss' }))
      setData((state) => ({ ...state, wallet, isReady: true }))
    } catch (e: any) {
      setStatus0((state) => ({
        ...state,
        type: 'error',
        data: new GoshError('Activate account failed', {
          message: e.message,
          retry: 'Retrying after 15s',
        }),
      }))
      setTimeout(activate, 15000)
    }
  }

  const getDetails = useCallback(async () => {
    if (!data.isReady || !data.wallet) {
      return
    }

    try {
      const balance = await data.wallet.getBalance()
      const limited = await data.wallet.isLimited()
      setData((state) => ({
        ...state,
        balance,
        allowance: balance.allowance,
        isLimited: limited,
      }))
    } catch (e: any) {
      console.error(e.message)
    }
  }, [data.isReady])

  const getBaseDetails = useCallback(async () => {
    if (!dao.members?.length || !dao.account) {
      return
    }
    if (!user.profile) {
      setData((state) => ({ ...state, isFetched: true }))
      return
    }

    const client = getSystemContract().client
    const found = dao.members.find(({ profile }) => profile.address === user.profile)
    const wallet = await dao.account.getMemberWallet({
      data: { profile: user.profile },
      keys: user.keys,
    })
    const walletDeployed = await wallet.isDeployed()
    const profile = new UserProfile(client, user.profile!, user.keys)
    activate(profile, wallet)
    setData((state) => ({
      ...state,
      profile,
      wallet: walletDeployed ? wallet : null,
      allowance: found?.allowance || 0,
      isMember: !!found,
      isFetched: true,
    }))
  }, [user.profile, dao.members?.length, dao.address])

  useEffect(() => {
    if (initialize) {
      getBaseDetails()
    }
  }, [getBaseDetails, initialize])

  useEffect(() => {
    if (initialize) {
      getDetails()
    }
  }, [getDetails, initialize])

  useEffect(() => {
    if (!subscribe) {
      return
    }

    const interval = setLockableInterval(async () => {
      await getDetails()
    }, 15000)

    return () => {
      clearInterval(interval)
    }
  }, [getDetails, subscribe])

  return data
}

export function useDaoMemberList(
  params: { count?: number; search?: string; initialize?: boolean } = {},
) {
  const { count = 10, search, initialize } = params
  const { details: dao } = useDao()
  const [data, setData] = useRecoilState(
    daoMemberListSelector({ daoname: dao.name, search }),
  )

  const getMemberList = useCallback(
    async (from: number, to?: number) => {
      try {
        setData((state) => ({ ...state, isFetching: true }))

        to = to || from + count
        const items = await executeByChunk<TDaoDetailsMemberItem, TDaoMemberListItem>(
          dao.members?.slice(from, to) || [],
          MAX_PARALLEL_READ,
          async (item) => {
            const { profile } = item
            const username = await profile.getName()
            const { voting, locked, regular } = await item.wallet.getBalance()
            return {
              ...item,
              username,
              balance: Math.max(voting, locked) + regular,
              isFetching: false,
            }
          },
        )

        setData((state) => {
          const different = _.differenceWith(
            items,
            state.items,
            (a, b) => a.profile.address === b.profile.address,
          )
          const intersect = _.intersectionWith(
            items,
            state.items,
            (a, b) => a.profile.address === b.profile.address,
          )

          return {
            ...state,
            items: [...different, ...state.items].map((item) => {
              const found = intersect.find(
                (_item) => _item.profile.address === item.profile.address,
              )
              return { ...item, ...found } || item
            }),
          }
        })
      } catch (e: any) {
        setData((state) => ({ ...state, error: e }))
      } finally {
        setData((state) => ({ ...state, isFetching: false }))
      }
    },
    [dao.address, dao.members?.length],
  )

  const getNext = useCallback(async () => {
    await getMemberList(data.items.length)
  }, [data.items.length])

  useEffect(() => {
    if (initialize) {
      getMemberList(0, data.items.length)
    }
  }, [getMemberList, initialize])

  return {
    ...data,
    hasNext: data.items.length < (dao.members?.length || 1),
    getNext,
  }
}

export function useDaoHelpers() {
  const { details: dao } = useDao()
  const member = useDaoMember()

  const nocallback = () => {}

  const beforeCreateEvent = async (
    min: number,
    options: {
      onPendingCallback?: (status: TToastStatus) => void
      onSuccessCallback?: (status: TToastStatus) => void
      onErrorCallback?: (status: TToastStatus) => void
    },
  ) => {
    const {
      onPendingCallback = nocallback,
      onSuccessCallback = nocallback,
      onErrorCallback = nocallback,
    } = options

    try {
      onPendingCallback({ type: 'pending', data: 'Prepare balances' })

      // Check wallet readyness
      if (!member.wallet || !member.isReady) {
        throw new GoshError('Access error', 'Wallet does not exist or not activated')
      }

      // Check for minimum tokens needed to create event
      if (min === 0) {
        return
      }

      // Check for member allowance
      if (member.allowance! < min) {
        throw new GoshError('Karma error', {
          message: 'Not enough karma',
          yours: member.allowance,
          needed: min,
        })
      }

      // Check locker status
      if (await member.wallet.smvLockerBusy()) {
        onPendingCallback({ type: 'pending', data: 'Wait for locker' })

        const wait = await whileFinite(async () => {
          return !(await member.wallet!.smvLockerBusy())
        })
        if (!wait) {
          throw new GoshError('Timeout error', 'Wait for locker ready timeout')
        }
      }

      // Convert regular tokens to voting
      onPendingCallback({ type: 'pending', data: 'Moving tokens' })
      const { voting, locked, regular } = await member.wallet.getBalance()
      if (voting >= min || locked >= min) {
        return
      }

      if (regular >= min - voting) {
        await member.wallet.smvLockTokens(0)
        const check = await whileFinite(async () => {
          const { voting } = await member.wallet!.getBalance()
          return voting >= min
        })
        if (!check) {
          throw new GoshError('Timeout error', 'Lock tokens error')
        }

        onSuccessCallback({ type: 'success', data: 'Prepare balances completed' })
        return
      }

      throw new GoshError('Balance error', {
        needed: min,
        message: "You don't have enough tokens to create event",
      })
    } catch (e: any) {
      onErrorCallback({ type: 'error', data: e })
      throw e
    }
  }

  const beforeVote = async (
    amount: number,
    platformId: string,
    options: {
      onPendingCallback?: (status: TToastStatus) => void
      onSuccessCallback?: (status: TToastStatus) => void
      onErrorCallback?: (status: TToastStatus) => void
    },
  ) => {
    const {
      onPendingCallback = nocallback,
      onSuccessCallback = nocallback,
      onErrorCallback = nocallback,
    } = options

    try {
      onPendingCallback({ type: 'pending', data: 'Prepare balances' })

      // Check wallet readyness
      if (!member.wallet || !member.isReady) {
        throw new GoshError('Access error', 'Wallet does not exist or not activated')
      }

      // Check for member allowance
      if (member.allowance! < amount) {
        throw new GoshError('Karma error', {
          message: 'Not enough karma',
          yours: member.allowance,
          wanted: amount,
        })
      }

      // Check locker status
      if (await member.wallet.smvLockerBusy()) {
        onPendingCallback({ type: 'pending', data: 'Wait for locker' })

        const wait = await whileFinite(async () => {
          return !(await member.wallet!.smvLockerBusy())
        })
        if (!wait) {
          throw new GoshError('Timeout error', 'Wait for locker ready timeout')
        }
      }

      // Convert regular tokens to voting
      onPendingCallback({ type: 'pending', data: 'Moving tokens' })
      const { voting, regular } = await member.wallet.getBalance()
      const locked = await member.wallet.smvEventVotes(platformId)
      const unlocked = voting - locked
      if (unlocked < amount) {
        const delta = amount - unlocked
        if (regular < delta) {
          throw new GoshError('Balance error', {
            message: "You don't have enough tokens to vote",
          })
        }

        await member.wallet.smvLockTokens(delta)
        const check = await whileFinite(async () => {
          const { voting } = await member.wallet!.getBalance()
          return voting >= amount
        })
        if (!check) {
          throw new GoshError('Timeout error', 'Lock tokens error')
        }
      }

      onSuccessCallback({ type: 'success', data: 'Prepare balances completed' })
    } catch (e: any) {
      onErrorCallback({ type: 'error', data: e })
      throw e
    }
  }

  const voting2regular = async (
    needed: number,
    options: {
      onPendingCallback?: (status: TToastStatus) => void
      onSuccessCallback?: (status: TToastStatus) => void
      onErrorCallback?: (status: TToastStatus) => void
    },
  ) => {
    const {
      onPendingCallback = nocallback,
      onSuccessCallback = nocallback,
      onErrorCallback = nocallback,
    } = options

    try {
      // Check wallet readyness
      if (!member.wallet || !member.isReady) {
        throw new GoshError('Access error', 'Wallet does not exist or not activated')
      }

      // Check locker status
      if (await member.wallet.smvLockerBusy()) {
        onPendingCallback({ type: 'pending', data: 'Wait for locker' })

        const wait = await whileFinite(async () => {
          return !(await member.wallet!.smvLockerBusy())
        })
        if (!wait) {
          throw new GoshError('Timeout error', 'Wait for locker ready timeout')
        }
      }

      const regular = member.balance?.regular || 0
      if (needed > regular) {
        const delta = needed - regular
        await member.wallet.smvReleaseTokens()
        await member.wallet.smvUnlockTokens(delta)
        const check = await whileFinite(async () => {
          const { regular } = await member.wallet!.getBalance()
          return regular >= needed
        })
        if (!check) {
          throw new GoshError('Regular tokens topup failed')
        }
      }

      onSuccessCallback({ type: 'success', data: 'Prepare balances completed' })
    } catch (e: any) {
      onErrorCallback({ type: 'error', data: e })
      throw e
    }
  }

  const checkDaoWallet = async (profile: string) => {
    const isMember = await dao.account!.isMember(profile)
    if (!isMember) {
      const wallet = await dao.account!.getMemberWallet({ data: { profile } })
      await dao.account!.createLimitedWallet(profile)
      const wait = await whileFinite(async () => {
        return await wallet.isDeployed()
      })
      if (!wait) {
        throw new GoshError('Timeout error', 'Create DAO wallet timeout reached')
      }
    }

    return { isMember }
  }

  return {
    beforeCreateEvent,
    beforeVote,
    voting2regular,
    checkDaoWallet,
  }
}

export function useCreateDaoMember() {
  const { user } = useUser()
  const { details: dao } = useDao()
  const member = useDaoMember()
  const setInviteList = useSetRecoilState(daoInviteListAtom)
  const { beforeCreateEvent } = useDaoHelpers()
  const [status, setStatus] = useRecoilState(appToastStatusSelector('__createdaomember'))

  const getInvitationToken = useCallback(() => {
    if (!dao.name) {
      throw new GoshError('Generate token error', 'DAO name is undefined')
    }

    const data = {
      dao: dao.name,
      nonce: Date.now() + Math.round(Math.random() * 1000),
    }
    return Buffer.from(JSON.stringify(data)).toString('base64')
  }, [dao.name])

  const createInvitation = useCallback(
    async (extra?: any) => {
      if (!user.username) {
        throw new GoshError('Create link error', 'Username is undefined')
      }

      // Generate token and write to db
      const token = getInvitationToken()
      const { data, error } = await supabase.client
        .from('dao_invite')
        .insert({
          dao_name: dao.name,
          sender_username: user.username,
          is_recipient_sent: true,
          token,
          token_expired: false,
          ...extra,
        })
        .select()
      if (error) {
        throw new GoshError('Create link error', error.message)
      }

      // Update DAO invite list state
      setInviteList((state) => ({
        ...state,
        items: [
          {
            id: data![0].id,
            token,
            email: extra?.recipient_email,
            allowance: extra?.recipient_allowance,
            comment: extra?.recipient_comment,
          },
          ...state.items,
        ],
      }))

      return token
    },
    [getInvitationToken],
  )

  const createMember = useCallback(
    async (
      items: {
        user: { name: string; type: 'user' | 'email' }
        allowance: number
        comment?: string
      }[],
    ) => {
      try {
        // Check total allowance against reserve
        const allowance = _.sum(items.map(({ allowance }) => allowance))
        const reserve = dao.supply?.reserve || 0
        if (allowance > reserve) {
          throw new GoshError('DAO reserve error', {
            karma: allowance,
            reserve,
            message: 'Members total karma can not be greater than DAO reserve',
          })
        }

        // Create invite links for user type `email`
        const invites = items
          .filter(({ user }) => user.type === 'email')
          .map((item) => ({
            recipient_email: item.user.name,
            recipient_allowance: item.allowance,
            recipient_comment: item.comment,
            is_recipient_sent: false,
          }))
        const invitesEmailList = invites.map((item) => item.recipient_email)
        const invitesUnique = invites.filter((item, index) => {
          return invitesEmailList.indexOf(item.recipient_email) === index
        })
        await Promise.all(
          invitesUnique.map(async (item) => {
            await createInvitation(item)
          }),
        )

        // Add DAO members by username
        const users = items.filter(({ user }) => user.type === 'user')
        const usersList = users.map(({ user }) => {
          return `${user.name}.${user.type}`
        })
        const usersUnique = users.filter(({ user }, index) => {
          return usersList.indexOf(`${user.name}.${user.type}`) === index
        })

        // Resolve username -> profile
        setStatus((state) => ({
          ...state,
          type: 'pending',
          data: 'Resolve user profiles',
        }))
        const profiles = await executeByChunk(
          usersUnique,
          MAX_PARALLEL_READ,
          async ({ user, allowance }) => {
            const profile = await AppConfig.goshroot.getUserProfile({
              username: user.name.toLowerCase(),
            })
            if (!(await profile.isDeployed())) {
              throw new GoshError('Profile error', {
                message: 'Profile does not exist',
                username: user.name,
              })
            }
            return { profile: profile.address, allowance }
          },
        )
        const comment = usersUnique
          .map(({ comment, user, allowance }) => {
            return comment || `Add ${user.name} with ${allowance} karma`
          })
          .join('\n\n')

        // Prepare balance for create event (if not alone)
        const alone = dao.members?.length === 1 && member.isMember
        if (!alone) {
          await beforeCreateEvent(0, { onPendingCallback: setStatus })
        }

        // Create add DAO member event
        // Skip `member.wallet` check, because `beforeCreate` checks it
        await member.wallet!.createDaoMember({
          members: profiles,
          comment,
          alone,
        })

        setStatus((state) => ({
          ...state,
          type: 'success',
          data: {
            title: 'Add DAO members',
            content: 'Members add event created',
          },
        }))
      } catch (e: any) {
        setStatus((state) => ({ ...state, type: 'error', data: e }))
        throw e
      }
    },
    [
      dao.members?.length,
      dao.supply?.reserve,
      member.isMember,
      member.isReady,
      createInvitation,
    ],
  )

  return {
    status,
    createMember,
    getInvitationToken,
    createInvitation,
  }
}

export function useDeleteDaoMember() {
  const { details: dao } = useDao()
  const member = useDaoMember()
  const setMemberList = useSetRecoilState(daoMemberListSelector({ daoname: dao.name }))
  const { beforeCreateEvent } = useDaoHelpers()
  const [status, setStatus] = useRecoilState(appToastStatusSelector('__deletedaomember'))

  const deleteMember = async (username: string[], comment?: string) => {
    try {
      setMemberList((state) => ({
        ...state,
        items: state.items.map((item) => ({
          ...item,
          isFetching: username.indexOf(item.username) >= 0,
        })),
      }))

      // Resolve username -> profile
      setStatus((state) => ({
        ...state,
        type: 'pending',
        data: 'Resolve user profiles',
      }))
      const profiles = await executeByChunk(username, MAX_PARALLEL_READ, async (name) => {
        const profile = await AppConfig.goshroot.getUserProfile({
          username: name.toLowerCase(),
        })
        if (!(await profile.isDeployed())) {
          throw new GoshError('Profile error', {
            message: 'Profile does not exist',
            username: name,
          })
        }
        return profile.address
      })

      // Prepare balance for create event
      await beforeCreateEvent(20, { onPendingCallback: setStatus })

      // Create add DAO member event
      // Skip `member.wallet` check, because `beforeCreate` checks it
      await member.wallet!.deleteDaoMember({
        profile: profiles,
        comment: comment || `Delete members ${username.join(', ')}`,
      })

      setStatus((state) => ({
        ...state,
        type: 'success',
        data: { title: 'Remove DAO members', content: 'Event created' },
      }))
    } catch (e: any) {
      setStatus((state) => ({ ...state, type: 'error', data: e }))
      throw e
    } finally {
      setMemberList((state) => ({
        ...state,
        items: state.items.map((item) => ({ ...item, isFetching: false })),
      }))
    }
  }

  return {
    status,
    deleteMember,
  }
}

export function useUpdateDaoMember() {
  const { details: dao } = useDao()
  const member = useDaoMember()
  const { beforeCreateEvent } = useDaoHelpers()
  const [status, setStatus] = useRecoilState(appToastStatusSelector('__updatedaomember'))

  const updateMember = useCallback(
    async (
      items: {
        username: string
        allowance: number
        _allowance: number
        balance: number
        _balance: number
      }[],
      comment?: string,
    ) => {
      try {
        setStatus((state) => ({
          ...state,
          type: 'pending',
          data: 'Validating changes',
        }))
        // Check total allowance against DAO total supply
        const allowance = _.sum(items.map(({ allowance }) => allowance))
        const supply = dao.supply?.total || 0
        if (allowance > supply) {
          throw new GoshError('DAO supply error', {
            karma: allowance,
            supply,
            message: 'Members total karma can not be greater than DAO total supply',
          })
        }

        // Check total balance against DAO reserve
        const balance = _.sum(items.map(({ balance }) => balance))
        const reserve = dao.supply?.reserve || 0
        if (balance > reserve) {
          throw new GoshError('DAO reserve error', {
            balance,
            reserve,
            message: 'Members total balance can not be greater than DAO reserve',
          })
        }

        // Check allowance against balance
        for (const item of items) {
          if (item.allowance > item.balance) {
            throw new GoshError('Value error', {
              message: 'Member karma can not be greater than token balance',
              username: item.username,
              karma: item.allowance,
              balance: item.balance,
            })
          }
        }

        // Resolve username -> profile
        setStatus((state) => ({
          ...state,
          type: 'pending',
          data: 'Resolve user profiles',
        }))
        const profiles = await executeByChunk(items, MAX_PARALLEL_READ, async (item) => {
          const profile = await AppConfig.goshroot.getUserProfile({
            username: item.username.toLowerCase(),
          })
          if (!(await profile.isDeployed())) {
            throw new GoshError('Profile error', {
              message: 'Profile does not exist',
              username: item.username,
            })
          }
          return { ...item, profile: profile.address }
        })

        // Prepare event data
        const events = []
        for (const item of profiles) {
          // Balance change
          if (item.balance > item._balance) {
            const delta = item.balance - item._balance
            events.push({
              type: EDaoEventType.DAO_TOKEN_REGULAR_ADD,
              params: {
                profile: item.profile,
                amount: delta,
                comment: `Add ${delta} regular tokens to ${item.username}`,
              },
              fn: 'addDaoRegularTokens',
            })
          }

          // Allowance change
          if (item.allowance - item._allowance !== 0) {
            const delta = Math.abs(item.allowance - item._allowance)
            events.push({
              type: EDaoEventType.DAO_ALLOWANCE_CHANGE,
              params: {
                members: [
                  {
                    profile: item.profile,
                    increase: item.allowance > item._allowance,
                    amount: delta,
                  },
                ],
                comment: `Change member karma from ${item._allowance} to ${item.allowance}`,
              },
              fn: 'updateDaoMemberAllowance',
            })
          }
        }

        // Prepare balance for create event
        await beforeCreateEvent(20, { onPendingCallback: setStatus })

        // Create update DAO member event
        // Skip `member.wallet` check, because `beforeCreate` checks it
        if (events.length === 0) {
          throw new GoshError('Value error', 'Nothing was changed')
        } else if (events.length === 1) {
          // TODO: Think how to make better
          // @ts-ignore
          await member.wallet[events[0].fn](events[0].params)
        } else {
          await member.wallet!.createMultiEvent({
            proposals: events,
            comment: comment || 'Update DAO members',
          })
        }

        setStatus((state) => ({
          ...state,
          type: 'success',
          data: {
            title: 'Update DAO members',
            content: 'Members update event created',
          },
        }))
      } catch (e: any) {
        setStatus((state) => ({ ...state, type: 'error', data: e }))
        throw e
      }
    },
    [dao.supply?.total, dao.supply?.reserve, member.isMember, member.isReady],
  )

  return {
    status,
    updateMember,
  }
}

export function useDaoEventList(params: { count?: number; initialize?: boolean } = {}) {
  const { count = 10, initialize } = params
  const { details: dao } = useDao()
  const member = useDaoMember()
  const [data, setData] = useRecoilState(daoEventListSelector(dao.name))

  const getBlockchainItems = async (params: {
    dao: Dao
    wallet: DaoWallet | null
    limit: number
    cursor?: string
  }) => {
    const { dao, wallet, limit, cursor } = params
    const codeHash = await dao.getEventCodeHash()
    const { results, lastId, completed } = await getPaginatedAccounts({
      filters: [`code_hash: {eq:"${codeHash}"}`],
      result: ['last_paid'],
      limit,
      lastId: cursor,
    })
    const items = await executeByChunk<any, TDaoEventDetails>(
      results,
      MAX_PARALLEL_READ,
      async ({ id, last_paid }) => {
        const account = await dao.getEvent({ address: id })
        const details = await account.getDetails({ wallet })
        return {
          account,
          address: id,
          updatedAt: last_paid,
          ...details,
        }
      },
    )
    return { items, cursor: lastId, hasNext: !completed }
  }

  const getEventList = useCallback(async () => {
    try {
      if (!dao.address || !member.isFetched) {
        return
      }

      setData((state) => ({ ...state, isFetching: true }))
      const blockchain = await getBlockchainItems({
        dao: dao.account!,
        wallet: member.wallet,
        limit: count,
      })
      setData((state) => {
        const different = _.differenceWith(
          blockchain.items,
          state.items,
          (a, b) => a.address === b.address,
        )
        const intersect = _.intersectionWith(
          blockchain.items,
          state.items,
          (a, b) => a.address === b.address,
        )
        return {
          ...state,
          items: [...different, ...state.items].map((item) => {
            const found = intersect.find((_item) => {
              return _item.address === item.address
            })
            return found ? { ...item, ...found } : item
          }),
          cursor: blockchain.cursor,
          hasNext: blockchain.hasNext,
        }
      })
    } catch (e) {
      setData((state) => ({ ...state, error: e }))
    } finally {
      setData((state) => ({ ...state, isFetching: false }))
    }
  }, [dao.address, member.isFetched, count])

  const getNext = useCallback(async () => {
    try {
      setData((state) => ({ ...state, isFetching: true }))
      const blockchain = await getBlockchainItems({
        dao: dao.account!,
        wallet: member.wallet,
        limit: count,
        cursor: data.cursor,
      })
      setData((state) => {
        const different = _.differenceWith(
          blockchain.items,
          state.items,
          (a, b) => a.address === b.address,
        )

        return {
          ...state,
          items: [...state.items, ...different],
          cursor: blockchain.cursor,
          hasNext: blockchain.hasNext,
        }
      })
    } catch (e: any) {
      throw e
    } finally {
      setData((state) => ({ ...state, isFetching: false }))
    }
  }, [dao.address, data.cursor, member.isFetched])

  const openItem = (address: string) => {
    setData((state) => ({
      ...state,
      items: state.items.map((item) => ({
        ...item,
        isOpen: item.address === address,
      })),
    }))
  }

  const closeItems = () => {
    setData((state) => ({
      ...state,
      items: state.items.map((item) => ({ ...item, isOpen: false })),
    }))
  }

  useEffect(() => {
    if (initialize) {
      getEventList()
    }
  }, [getEventList, initialize])

  return {
    ...data,
    openItem,
    closeItems,
    getNext,
    isEmpty: !data.isFetching && !data.items.length,
  }
}

export function useDaoEvent(
  address: string,
  options: { initialize?: boolean; subscribe?: boolean } = {},
) {
  const { initialize, subscribe } = options
  const { details: dao } = useDao()
  const member = useDaoMember()
  const [events, setEvents] = useRecoilState(daoEventListSelector(dao.name))
  const event = useRecoilValue(daoEventSelector(address))
  const [error, setError] = useState<any>()

  const getEvent = useCallback(async () => {
    if (!dao.account || !address || !member.isFetched) {
      return
    }

    try {
      // Search for event in event list state atom
      let found = events.items.find((item) => item.address === address)

      // Fetch event details from blockchain
      if (!found || !found.status.completed) {
        const account = found ? found.account : await dao.account.getEvent({ address })
        const details = await account.getDetails({ wallet: member.wallet })
        const accdata = await account.account.getAccount()
        found = {
          ...found,
          ...details,
          account,
          address,
          updatedAt: accdata.last_paid,
        }

        setEvents((state) => {
          const updated = [...state.items]
          if (!updated.find(({ address }) => address === found?.address)) {
            updated.push({ ...found!, isOpen: true })
          }

          return {
            ...state,
            items: updated.map((item) => {
              if (item.address === address) {
                return { ...item, ...found, isOpen: item.isOpen }
              }
              return item
            }),
          }
        })
      }

      // Fetch event data if not present
      if (!found.data) {
        getEventData(found.account!, found.type)
      }
    } catch (e: any) {
      setError(e)
    }
  }, [address, dao.address, member.isFetched])

  const getEventData = async (account: DaoEvent, type: number) => {
    try {
      const verbose = await account.getData(type, { verbose: true })
      setEvents((state) => ({
        ...state,
        items: state.items.map((item) => {
          if (item.address === account.address) {
            return { ...item, data: verbose }
          }
          return item
        }),
      }))
    } catch (e: any) {
      setError(e)
    }
  }

  const subscribeEvent = useCallback(async () => {
    if (!event?.address || !event.account) {
      return
    }

    await event.account.account.subscribeMessages('body', async ({ body }) => {
      const decoded = await event.account!.decodeMessageBody(body, 0)
      const triggers = ['acceptReviewer', 'rejectReviewer', 'updateHead', 'vote']
      if (decoded && triggers.indexOf(decoded.name) >= 0) {
        const details = await event.account!.getDetails({
          wallet: member.wallet,
        })
        setEvents((state) => ({
          ...state,
          items: state.items.map((item) => {
            if (item.address === event!.address) {
              return { ...item, ...details }
            }
            return item
          }),
        }))
      }
    })
  }, [event?.address, member.isFetched])

  useEffect(() => {
    if (initialize) {
      getEvent()
    }
  }, [getEvent, initialize])

  useEffect(() => {
    if (subscribe) {
      getEvent()
      subscribeEvent()
    }

    return () => {
      if (subscribe) {
        event?.account?.account.free()
      }
    }
  }, [getEvent, subscribeEvent, subscribe])

  return { event, error }
}

export function useReviewDaoEvent() {
  const member = useDaoMember()

  const review = useCallback(
    async (params: { eventaddr: string; decision: boolean }) => {
      if (!member.isReady || !member.wallet) {
        throw new GoshError('Access error', 'Wallet does not exist or not activated')
      }

      await member.wallet.sendDaoEventReview(params)
    },
    [member.isReady],
  )

  return { review }
}

export function useVoteDaoEvent() {
  const member = useDaoMember()
  const { beforeVote } = useDaoHelpers()
  const [status, setStatus] = useRecoilState(appToastStatusSelector('__voteforevent'))

  const vote = async (params: {
    platformId: string
    choice: boolean
    amount: number
  }) => {
    const { platformId, choice, amount } = params
    try {
      // Prepare balance for create event
      await beforeVote(amount, platformId, { onPendingCallback: setStatus })

      // Send vote
      // Skip `member.wallet` check, because `beforeVote` checks it
      await member.wallet!.smvVote({ platformId, choice, amount })

      setStatus((state) => ({
        ...state,
        type: 'success',
        data: {
          title: 'Send vote',
          content: 'Your vote was succesfully sent',
        },
      }))
    } catch (e: any) {
      setStatus((state) => ({ ...state, type: 'error', data: e }))
      throw e
    }
  }

  return { vote, status }
}

export function useUpgradeDao() {
  const dao = useDao()
  const member = useDaoMember()
  const { beforeCreateEvent } = useDaoHelpers()
  const [versions, setVersions] = useState<string[]>()
  const [alert, setAlert] = useState<
    'isNotLatest' | 'isUpgradeAvailable' | 'isUpgradeUncompleted'
  >()
  const [status, setStatus] = useRecoilState(appToastStatusSelector('__upgradedao'))

  const getAvailableVersions = useCallback(() => {
    const all = Object.keys(AppConfig.versions)
    const currIndex = all.findIndex((v) => v === dao.details.version)
    setVersions(all.slice(currIndex + 1))
  }, [dao.details.version])

  const checkUpgrades = useCallback(async () => {
    const { version, name } = dao.details
    if (!version || !member.isMember) {
      setAlert(undefined)
      return
    }

    if (alert === 'isNotLatest') {
      return
    }

    // Check if using latest version of DAO or new version avaiable
    const versions = Object.keys(AppConfig.versions)
    const currVerIndex = versions.findIndex((v) => v === version)
    const nextVersions = versions
      .slice(currVerIndex + 1)
      .filter((v) => DISABLED_VERSIONS.indexOf(v) < 0)
    if (nextVersions.length && nextVersions.indexOf(version) < 0) {
      const next = await Promise.all(
        nextVersions.map(async (ver) => {
          const gosh = AppConfig.goshroot.getSystemContract(ver)
          const account = await gosh.getDao({ name: name })
          return await account.isDeployed()
        }),
      )

      // There is a deployed DAO with greater version
      if (next.some((v) => v === true)) {
        setAlert('isNotLatest')
        return
      }

      // Upgrade available (only if current version is fully upgraded)
      if (dao.details.isUpgraded) {
        setAlert('isUpgradeAvailable')
        return
      }
    }

    // Check if DAO is fully upgraded
    if (!dao.details.isUpgraded) {
      setAlert('isUpgradeUncompleted')
      return
    }

    // Reset upgrades alert
    setAlert(undefined)
  }, [dao.details, member.isMember])

  const upgrade = useCallback(
    async (version: string, comment: string) => {
      try {
        if (Object.keys(AppConfig.versions).indexOf(version) < 0) {
          throw new GoshError('Upgrade error', `Gosh version ${version} is not supported`)
        }
        if (!dao.details.account || !dao.details.name) {
          throw new GoshError('Upgrade error', 'DAO account undefined')
        }

        // Check if there are no opened events
        setStatus((state) => ({
          ...state,
          type: 'pending',
          data: 'Check upgrade possibility',
        }))

        let cursor
        const code = await dao.details.account.getEventCodeHash()
        while (true) {
          const { results, lastId, completed } = await getPaginatedAccounts({
            filters: [`code_hash: {eq:"${code}"}`],
            lastId: cursor,
          })
          const items = await executeByChunk<{ id: string }, boolean>(
            results,
            MAX_PARALLEL_READ,
            async ({ id }) => {
              const account = await dao.details.account!.getEvent({
                address: id,
              })
              const details = await account.getDetails({})
              return details.status.completed
            },
          )

          if (items.some((v) => v === false)) {
            throw new GoshError(
              'Upgrade error',
              'DAO has opened events, you should complete all events before upgrade',
            )
          }
          if (completed) {
            break
          }

          await sleep(100)
          cursor = lastId
        }

        // Prepare balance for create event
        await beforeCreateEvent(20, { onPendingCallback: setStatus })

        // Create upgrade DAO event
        // Skip `member.wallet` check, because `beforeCreate` checks it
        await member.wallet!.upgradeDao({ version, description: comment })

        setStatus((state) => ({
          ...state,
          type: 'success',
          data: { title: 'Upgrade DAO', content: 'Event created' },
        }))
      } catch (e: any) {
        setStatus((state) => ({ ...state, type: 'error', data: e }))
        throw e
      }
    },
    [dao.details.address, dao.details.name],
  )

  useEffect(() => {
    getAvailableVersions()
  }, [getAvailableVersions])

  useEffect(() => {
    checkUpgrades()
  }, [checkUpgrades])

  return { versions, upgrade, status, alert }
}

export function useUpgradeDaoComplete() {
  const dao = useDao()
  const member = useDaoMember()
  const [status, setStatus] = useRecoilState(
    appToastStatusSelector('__upgradedaocomplete'),
  )

  const getRepositories = async (params: { daoname: string; daover: string }) => {
    const { daoname, daover } = params

    // Get repositories accounts from all DAO versions
    const versions = Object.keys(AppConfig.versions).reverse()
    const items: { address: string; version: string }[] = []
    const _gosh: { [v: string]: TSystemContract } = {}
    for (const ver of versions) {
      _gosh[ver] = AppConfig.goshroot.getSystemContract(ver)
      const _dao = await _gosh[ver].getDao({ name: daoname })
      if (!(await _dao.isDeployed())) {
        continue
      }

      const codeHash = await _gosh[ver].getRepositoryCodeHash(_dao.address)
      const result = await getAllAccounts({
        filters: [`code_hash: {eq:"${codeHash}"}`],
      })
      items.push(...result.map(({ id }) => ({ address: id, version: ver })))
    }

    // Get repositories accounts with data
    const accounts = await executeByChunk(
      items,
      MAX_PARALLEL_READ,
      async ({ address, version }) => {
        const repository = await _gosh[version].getRepository({ address })
        const name = await repository.getName()
        return { account: repository, address, name, version }
      },
    )

    // Prepare repositories for upgrade
    const current = accounts
      .filter(({ version }) => version === daover)
      .map(({ name }) => name)
    const rest = accounts.filter(({ version }) => version !== daover)
    const upgradeable = []
    for (const item of rest) {
      if (current.indexOf(item.name) >= 0) {
        continue
      }
      if (upgradeable.findIndex((i) => i.name === item.name) >= 0) {
        continue
      }
      upgradeable.push(item)
    }

    return upgradeable
  }

  const getRepositoriesCommitTags = async (repositories: any[]) => {
    const tags = []
    for (const item of repositories) {
      const code = await item.account.getCommitTagCodeHash()
      const accounts = await getAllAccounts({
        filters: [`code_hash: {eq:"${code}"}`],
      })
      const repotags = await executeByChunk<any, TGoshCommitTag>(
        accounts,
        MAX_PARALLEL_READ,
        async ({ id }) => {
          const tag = await item.account.getCommitTag({ address: id })
          return await tag.getDetails()
        },
      )
      tags.push(...repotags)
    }
    return tags
  }

  const upgradeRepositories = async (params: {
    wallet: DaoWallet
    daoname: string
    daover: string
    alone: boolean
  }) => {
    const { wallet, alone, ...rest } = params

    setStatus((state) => ({
      ...state,
      type: 'pending',
      data: 'Fetching repositories for upgrade',
    }))
    const repositories = await getRepositories(rest)

    setStatus((state) => ({
      ...state,
      type: 'pending',
      data: 'Fetching repositories commit tags',
    }))
    const tags = await getRepositoriesCommitTags(repositories)

    setStatus((state) => ({
      ...state,
      type: 'pending',
      data: 'Transfer repositories commit tags',
    }))
    await executeByChunk(tags, MAX_PARALLEL_WRITE, async (item) => {
      await wallet.createCommitTag(item)
    })

    setStatus((state) => ({
      ...state,
      type: 'pending',
      data: 'Transfer repositories',
    }))
    let isEvent = false
    const args = repositories.map(({ name, address, version }) => ({
      name,
      previous: { addr: address, version },
      comment: 'Upgrade repository',
    }))
    if (args.length === 1 || alone) {
      await executeByChunk(args, MAX_PARALLEL_WRITE, async (kwargs) => {
        await wallet.createRepository({ ...kwargs, alone })
      })
      isEvent = !alone
    } else if (args.length > 1) {
      await executeByChunk(splitByChunk(args, 50), MAX_PARALLEL_WRITE, async (chunk) => {
        await wallet.createMultiEvent({
          proposals: chunk.map((p) => ({
            type: EDaoEventType.REPO_CREATE,
            params: p,
          })),
          comment: 'Upgrade repositories',
        })
      })
      isEvent = true
    }

    setStatus((state) => ({ ...state, type: 'pending', data: 'Update DAO flag' }))
    await wallet.setRepositoriesUpgraded()
    return { isEvent }
  }

  const upgrade = useCallback(async () => {
    try {
      const { name: daoname, version, members, isRepoUpgraded } = dao.details
      if (!daoname || !version || !members?.length) {
        throw new GoshError('Upgrade error', 'DAO details undefined')
      }
      if (!member.isReady) {
        throw new GoshError('Wallet error', 'Wallet does not exist or not activated')
      }

      let isEvent = false

      // Upgrade repositories and commit tags
      if (!isRepoUpgraded) {
        const { isEvent: isRepositoriesEvent } = await upgradeRepositories({
          wallet: member.wallet!,
          daoname,
          daover: version,
          alone: members.length === 1,
        })
        isEvent = isEvent || isRepositoriesEvent
      }

      setStatus((state) => ({
        ...state,
        type: 'success',
        data: {
          title: 'DAO upgrade completed',
          content: isEvent
            ? 'Corresponding events created. Please, vote'
            : 'You can continue working with DAO',
        },
      }))
    } catch (e: any) {
      setStatus((state) => ({ ...state, type: 'error', data: e }))
      throw e
    }
  }, [
    dao.details.name,
    dao.details.version,
    dao.details.members?.length,
    dao.details.isRepoUpgraded,
    member.isReady,
  ])

  return { upgrade, status }
}

export function useUpdateDaoSettings() {
  const { details: dao } = useDao()
  const member = useDaoMember()
  const { beforeCreateEvent } = useDaoHelpers()
  const [status, setStatus] = useRecoilState(
    appToastStatusSelector('__updatedaosettings'),
  )

  const update = useCallback(
    async (params: {
      tags: string[]
      isMintOn: boolean
      isEventProgressOn: boolean
      isEventDiscussionOn: boolean
      isAskMembershipOn: boolean
      comment?: string
    }) => {
      try {
        if (!member.wallet || !member.isReady) {
          throw new GoshError('Access error', 'Wallet does not exist or not activated')
        }

        // Future events params
        const events = []

        // Check DAO tags updated
        const tagsAdded = _.differenceWith(params.tags, dao.tags || [])
        const tagsRemoved = _.differenceWith(dao.tags || [], params.tags)
        if (tagsAdded.length > 0) {
          events.push({
            type: EDaoEventType.DAO_TAG_ADD,
            params: { tags: tagsAdded, comment: 'Add DAO tags' },
            fn: 'createDaoTag',
          })
        }
        if (tagsRemoved.length > 0) {
          events.push({
            type: EDaoEventType.DAO_TAG_REMOVE,
            params: { tags: tagsRemoved, comment: 'Delete DAO tags' },
            fn: 'deleteDaoTag',
          })
        }

        // Minting tokens
        if (!params.isMintOn && dao.isMintOn) {
          events.push({
            type: EDaoEventType.DAO_TOKEN_MINT_DISABLE,
            params: { comment: 'Disable minting tokens' },
            fn: 'disableMintDaoTokens',
          })
        }

        // Show voting results for event until it is finished
        if (params.isEventProgressOn !== dao.isEventProgressOn) {
          events.push({
            type: EDaoEventType.DAO_EVENT_HIDE_PROGRESS,
            params: {
              decision: params.isEventProgressOn,
              comment: 'Hide voting results until event is over',
            },
            fn: 'updateDaoEventShowProgress',
          })
        }

        // Allow discussions on events
        if (params.isEventDiscussionOn !== dao.isEventDiscussionOn) {
          events.push({
            type: EDaoEventType.DAO_EVENT_ALLOW_DISCUSSION,
            params: {
              allow: params.isEventDiscussionOn,
              comment: 'Allow discussions on events',
            },
            fn: 'updateDaoEventAllowDiscussion',
          })
        }

        // Allow external users to request DAO membership
        if (params.isAskMembershipOn !== dao.isAskMembershipOn) {
          events.push({
            type: EDaoEventType.DAO_ASK_MEMBERSHIP_ALLOWANCE,
            params: {
              decision: params.isAskMembershipOn,
              comment: 'Allow external users to request DAO membership',
            },
            fn: 'updateDaoAskMembership',
          })
        }

        // Prepare balance for create event
        await beforeCreateEvent(20, { onPendingCallback: setStatus })

        // Create event/multievent
        if (events.length === 1) {
          // TODO: Think how to make better
          // @ts-ignore
          await member.wallet[events[0].fn](events[0].params)
        } else {
          await member.wallet.createMultiEvent({
            proposals: events,
            comment: 'Update DAO settings',
          })
        }

        setStatus((state) => ({
          ...state,
          type: 'success',
          data: {
            title: 'Update DAO settings',
            content: 'Update DAO settings event created',
          },
        }))
      } catch (e: any) {
        setStatus((state) => ({ ...state, type: 'error', data: e }))
        throw e
      }
    },
    [
      dao.tags,
      dao.isMintOn,
      dao.isEventProgressOn,
      dao.isEventDiscussionOn,
      dao.isAskMembershipOn,
      member.isMember,
      member.isReady,
    ],
  )

  return { update, status }
}

export function useMintDaoTokens() {
  const { details: dao } = useDao()
  const member = useDaoMember()
  const { beforeCreateEvent } = useDaoHelpers()
  const [status, setStatus] = useRecoilState(appToastStatusSelector('__mintdaotokens'))

  const mint = useCallback(
    async (params: { amount: number; comment?: string }) => {
      const { amount, comment } = params

      try {
        setStatus((state) => ({
          ...state,
          type: 'pending',
          data: 'Start tokens minting',
        }))

        if (!member.isMember) {
          throw new GoshError('Access error', 'Not a DAO member')
        }
        if (!member.isReady || !member.wallet) {
          throw new GoshError('Access error', 'Wallet is missing or is not activated')
        }
        if (!dao.isMintOn) {
          throw new GoshError('Minting error', 'Minting tokens is disabled for this DAO')
        }

        // Prepare balance for create event (if not alone)
        const alone = dao.members?.length === 1
        if (!alone) {
          await beforeCreateEvent(20, { onPendingCallback: setStatus })
        }

        // Mint tokens
        setStatus((state) => ({
          ...state,
          type: 'pending',
          data: 'Minting tokens',
        }))
        await member.wallet.mintDaoTokens({
          amount,
          comment: comment || `Mint ${amount.toLocaleString()} tokens`,
          alone,
        })

        // Update status depending on alone
        setStatus((state) => ({
          ...state,
          type: 'success',
          data: {
            title: 'Mint tokens',
            content: alone ? 'Tokens minted' : 'Mint tokens event created',
          },
        }))

        return { isEvent: !alone }
      } catch (e: any) {
        setStatus((state) => ({ ...state, type: 'error', data: e }))
        throw e
      }
    },
    [dao.members?.length, dao.isMintOn, member.isMember, member.isReady],
  )

  return { mint, status }
}

export function useSendDaoTokens() {
  const { details: dao } = useDao()
  const member = useDaoMember()
  const { beforeCreateEvent, checkDaoWallet } = useDaoHelpers()
  const [status, setStatus] = useRecoilState(appToastStatusSelector('__senddaotokens'))

  const send = useCallback(
    async (params: {
      username: string
      amount: number
      isVoting: boolean
      comment?: string
    }) => {
      const { username, amount, isVoting, comment } = params

      try {
        if (!member.isMember) {
          throw new GoshError('Access error', 'Not a DAO member')
        }
        if (!member.isReady || !member.wallet) {
          throw new GoshError('Access error', 'Wallet is missing or is not activated')
        }

        // Resolve username -> profile
        setStatus((state) => ({
          ...state,
          type: 'pending',
          data: 'Resolve username',
        }))
        const profile = await AppConfig.goshroot.getUserProfile({
          username: username.toLowerCase(),
        })
        if (!(await profile.isDeployed())) {
          throw new GoshError('Profile error', {
            message: 'Profile does not exist',
            username,
          })
        }

        // Deploy limited wallet if username has no wallet in DAO
        setStatus((state) => ({
          ...state,
          type: 'pending',
          data: 'Prepare user wallet',
        }))
        const { isMember } = await checkDaoWallet(profile.address)

        // Prepare balance for create event (if not alone)
        const alone = dao.members?.length === 1
        if (!alone) {
          await beforeCreateEvent(20, { onPendingCallback: setStatus })
        }

        // Send tokens
        setStatus((state) => ({
          ...state,
          type: 'pending',
          data: 'Sending tokens',
        }))
        const _txtTokens = isVoting ? 'voting' : 'regular'
        const _comment = `Send ${amount} ${_txtTokens} tokens to ${username}`
        const kwargs = {
          profile: profile.address,
          amount,
          comment: comment || _comment,
          alone,
        }
        if (isVoting) {
          if (isMember) {
            await member.wallet.addDaoVotingTokens(kwargs)
          } else {
            await member.wallet.createMultiEvent({
              proposals: [
                {
                  type: EDaoEventType.DAO_MEMBER_ADD,
                  params: {
                    members: [{ profile: profile.address, allowance: 0 }],
                    comment: `Add DAO member ${username}`,
                  },
                },
                {
                  type: EDaoEventType.DAO_TOKEN_MINT,
                  params: {
                    amount: 0,
                    comment: 'This is a service needed part',
                  },
                },
                {
                  type: EDaoEventType.DAO_TOKEN_VOTING_ADD,
                  params: {
                    profile: profile.address,
                    amount,
                    comment: `Add ${amount} karma for ${username}`,
                  },
                },
              ],
              comment: comment || _comment,
            })
          }
        } else {
          await member.wallet.addDaoRegularTokens(kwargs)
        }

        // Update status depending on alone
        setStatus((state) => ({
          ...state,
          type: 'success',
          data: {
            title: 'Send tokens',
            content: alone ? 'Tokens sent' : 'Send tokens event created',
          },
        }))

        return { isEvent: !alone || (isVoting && !isMember) }
      } catch (e: any) {
        setStatus((state) => ({ ...state, type: 'error', data: e }))
        throw e
      }
    },
    [dao.members?.length, member.isMember, member.isReady],
  )

  return { send, status }
}

export function useSendMemberTokens() {
  const { details: dao } = useDao()
  const member = useDaoMember()
  const { voting2regular, checkDaoWallet } = useDaoHelpers()
  const [status, setStatus] = useRecoilState(appToastStatusSelector('__sendmembertokens'))

  const send = useCallback(
    async (params: { username: string; amount: number }) => {
      const { username, amount } = params

      try {
        // Prepare balance
        await voting2regular(amount, { onPendingCallback: setStatus })

        // Skip `member.wallet` check, because `voting2regular` checks it
        // If DAO name - send to DAO reserve
        if (username === dao.name) {
          setStatus((state) => ({
            ...state,
            type: 'pending',
            data: 'Sending tokens to DAO reserve',
          }))
          await member.wallet!.sendTokensToDaoReserve(amount)
        } else {
          // Resolve username -> profile
          setStatus((state) => ({
            ...state,
            type: 'pending',
            data: 'Resolve username',
          }))
          const profile = await AppConfig.goshroot.getUserProfile({
            username: username.toLowerCase(),
          })
          if (!(await profile.isDeployed())) {
            throw new GoshError('Profile error', {
              message: 'Profile does not exist',
              username,
            })
          }

          // Deploy limited wallet if username has no wallet in DAO
          setStatus((state) => ({
            ...state,
            type: 'pending',
            data: 'Prepare user wallet',
          }))
          await checkDaoWallet(profile.address)

          // Send tokens
          setStatus((state) => ({
            ...state,
            type: 'pending',
            data: 'Sending tokens',
          }))
          await member.wallet!.sendTokensToDaoWallet(profile.address, amount)
        }

        // Update status
        setStatus((state) => ({
          ...state,
          type: 'success',
          data: { title: 'Send tokens', content: 'Tokens sent' },
        }))
      } catch (e: any) {
        setStatus((state) => ({ ...state, type: 'error', data: e }))
        throw e
      }
    },
    [dao.name, member.isReady, member.balance],
  )

  return { send, status }
}

export function useDaoInviteList(params: { initialize?: boolean } = {}) {
  const { initialize } = params
  const { details: dao } = useDao()
  const [data, setData] = useRecoilState(daoInviteListAtom)
  const { createMember } = useCreateDaoMember()
  const [status, setStatus] = useRecoilState(appToastStatusSelector('__createdaomember'))

  const revoke = async (id: string) => {
    try {
      setData((state) => ({
        ...state,
        items: state.items.map((item) => {
          return item.id !== id ? item : { ...item, isFetching: true }
        }),
      }))

      const { error } = await supabase.client
        .from('dao_invite')
        .update({
          recipient_status: EDaoInviteStatus.REVOKED,
          token_expired: true,
        })
        .eq('id', id)
      if (error) {
        throw new GoshError('Token revoke error', error.message)
      }

      setData((state) => ({
        ...state,
        items: state.items.filter((item) => item.id !== id),
      }))
    } catch (e: any) {
      throw e
    } finally {
      setData((state) => ({
        ...state,
        items: state.items.map((item) => {
          return item.id !== id ? item : { ...item, isFetching: false }
        }),
      }))
    }
  }

  const create = async (item: TDaoInviteListItem) => {
    try {
      if (!item.username) {
        throw new GoshError('Value error', 'Username is undefined')
      }

      setData((state) => ({
        ...state,
        items: state.items.map((i) => {
          return i.id !== item.id ? i : { ...item, isFetching: true }
        }),
      }))

      // Create DAO member
      await createMember([
        {
          user: { name: item.username, type: 'user' },
          allowance: item.allowance || 0,
          comment: item.comment,
        },
      ])

      // Update database
      const { error } = await supabase.client
        .from('dao_invite')
        .update({
          recipient_status: EDaoInviteStatus.PROPOSAL_CREATED,
          token_expired: true,
        })
        .eq('id', item.id)
      if (error) {
        throw new Error(error.message)
      }

      setData((state) => ({
        ...state,
        items: state.items.filter((i) => i.id !== item.id),
      }))
    } catch (e: any) {
      setStatus((state) => ({ ...state, type: 'error', data: e }))
      throw e
    } finally {
      setData((state) => ({
        ...state,
        items: state.items.map((i) => {
          return i.id !== item.id ? i : { ...item, isFetching: false }
        }),
      }))
    }
  }

  const getInviteList = useCallback(async () => {
    try {
      setData((state) => ({ ...state, isFetching: true }))

      const { data, error } = await supabase.client
        .from('dao_invite')
        .select(`*`)
        .eq('dao_name', dao.name)
        .not('token_expired', 'eq', true)
        .or(
          [
            'recipient_status.is.null',
            `recipient_status.eq.${EDaoInviteStatus.ACCEPTED}`,
          ].join(','),
        )
        .order('created_at', { ascending: false })
      if (error) {
        throw new Error(error.message)
      }

      setData((state) => ({
        ...state,
        items: (data || []).map((item) => ({
          id: item.id,
          token: item.token,
          username: item.recipient_username,
          email: item.recipient_email,
          status: item.recipient_status,
          allowance: item.recipient_allowance,
          comment: item.recipient_comment,
        })),
      }))
    } catch (e: any) {
      setData((state) => ({ ...state, error: e }))
    } finally {
      setData((state) => ({ ...state, isFetching: false }))
    }
  }, [dao.name])

  useEffect(() => {
    if (initialize) {
      getInviteList()
    }
  }, [getInviteList, initialize])

  return {
    ...data,
    isEmpty: !data.isFetching && !data.items.length,
    getInviteList,
    revoke,
    create,
    createStatus: status,
  }
}

export function useDaoTaskList(params: { count?: number; initialize?: boolean } = {}) {
  const { count = 10, initialize } = params
  const { details: dao } = useDao()
  const member = useDaoMember()
  const [data, setData] = useRecoilState(daoTaskListSelector(dao.name))

  const getBlockchainItems = async (params: {
    daoaddr: string
    limit: number
    cursor?: string
  }) => {
    const { daoaddr, limit, cursor } = params
    const sc = getSystemContract()
    const codeHash = await sc.getDaoTaskTagCodeHash(daoaddr, SYSTEM_TAG)
    const { results, lastId, completed } = await getPaginatedAccounts({
      filters: [`code_hash: {eq:"${codeHash}"}`],
      limit,
      lastId: cursor,
    })
    const items = await executeByChunk<{ id: string }, TTaskDetails>(
      results,
      MAX_PARALLEL_READ,
      async ({ id }) => {
        const tag = await sc.getGoshTag({ address: id })
        const { task: address } = await tag.getDetails()
        const task = await sc.getTask({ address })
        const details = await task.getDetails()
        return {
          account: task,
          address: task.address,
          ...details,
        }
      },
    )
    return { items, cursor: lastId, hasNext: !completed }
  }

  const getTaskList = useCallback(async () => {
    try {
      if (!dao.address) {
        return
      }
      setData((state) => ({ ...state, isFetching: true }))
      const blockchain = await getBlockchainItems({
        daoaddr: dao.address,
        limit: count,
      })
      setData((state) => {
        const different = _.differenceWith(
          blockchain.items,
          state.items,
          (a, b) => a.address === b.address,
        )
        const intersect = _.intersectionWith(
          blockchain.items,
          state.items,
          (a, b) => a.address === b.address,
        )

        return {
          ...state,
          items: [...different, ...state.items].map((item) => {
            const found = intersect.find((_item) => {
              return _item.address === item.address
            })
            return found ? { ...item, ...found } : item
          }),
          cursor: blockchain.cursor,
          hasNext: blockchain.hasNext,
        }
      })
    } catch (e) {
      setData((state) => ({ ...state, error: e }))
    } finally {
      setData((state) => ({ ...state, isFetching: false }))
    }
  }, [dao.address, count])

  const getNext = useCallback(async () => {
    try {
      setData((state) => ({ ...state, isFetching: true }))
      const blockchain = await getBlockchainItems({
        daoaddr: dao.address!,
        limit: count,
        cursor: data.cursor,
      })
      setData((state) => {
        const different = _.differenceWith(
          blockchain.items,
          state.items,
          (a, b) => a.address === b.address,
        )
        return {
          ...state,
          items: [...state.items, ...different],
          cursor: blockchain.cursor,
          hasNext: blockchain.hasNext,
        }
      })
    } catch (e: any) {
      throw e
    } finally {
      setData((state) => ({ ...state, isFetching: false }))
    }
  }, [dao.address, data.cursor, member.isFetched])

  const openItem = (address: string) => {
    setData((state) => ({
      ...state,
      items: state.items.map((item) => ({
        ...item,
        isOpen: item.address === address,
      })),
    }))
  }

  const closeItems = () => {
    setData((state) => ({
      ...state,
      items: state.items.map((item) => ({ ...item, isOpen: false })),
    }))
  }

  useEffect(() => {
    if (initialize) {
      getTaskList()
    }
  }, [getTaskList, initialize])

  return {
    ...data,
    openItem,
    closeItems,
    getNext,
    isEmpty: !data.isFetching && !data.items.length,
  }
}

export function useCreateTask() {
  const { details: dao } = useDao()
  const member = useDaoMember()
  const { beforeCreateEvent } = useDaoHelpers()
  const [status, setStatus] = useRecoilState(appToastStatusSelector('__createtask'))

  const getTokenAmount = (cost: number, percent: number) => {
    return Math.round((cost * percent) / 100)
  }

  const getVestingPart = (calculated: TTaskGrantPair[], parts: number, total: number) => {
    const sum = calculated.reduce((_sum, num) => _sum + num.grant, 0)
    const part = Math.ceil((total - sum) / parts)
    const value = sum + part <= total ? part : total - (sum + part)
    return value > 0 ? value : 0
  }

  const getCalculatedGrant = (values: {
    cost: number
    assign: number
    review: number
    manager: number
    lock: number
    vesting: number
  }) => {
    const { cost, assign, review, manager, lock, vesting } = values

    const lockSec = lock * 30 * 24 * 60 * 60
    const assignTokens = getTokenAmount(cost, assign)
    const reviewTokens = getTokenAmount(cost, review)
    const managerTokens = getTokenAmount(cost, manager)

    const struct: TTaskGrant = { assign: [], review: [], manager: [] }
    if (!vesting) {
      struct.assign.push({ grant: assignTokens, lock: lockSec })
      struct.review.push({ grant: reviewTokens, lock: lockSec })
      struct.manager.push({ grant: managerTokens, lock: lockSec })
      return struct
    }

    // Vesting calculate
    for (let i = 1; i <= vesting; i++) {
      const vLock = lockSec + i * 30 * 24 * 60 * 60
      const parts = i === 1 ? vesting : vesting - i + 1

      const vAssign = getVestingPart(struct.assign, parts, assignTokens)
      struct.assign.push({ grant: vAssign, lock: vLock })

      const vReview = getVestingPart(struct.review, parts, reviewTokens)
      struct.review.push({ grant: vReview, lock: vLock })

      const vManager = getVestingPart(struct.manager, parts, managerTokens)
      struct.manager.push({ grant: vManager, lock: vLock })
    }
    return struct
  }

  const createTask = useCallback(
    async (params: {
      reponame: string
      taskname: string
      cost: number
      assign: number
      review: number
      manager: number
      lock: number
      vesting: number
      tags?: string[]
      comment?: string
    }) => {
      try {
        if (!dao.name) {
          throw new GoshError('Value error', 'DAO name undefined')
        }

        setStatus((state) => ({
          ...state,
          type: 'pending',
          data: 'Validating data',
        }))

        // Get task config
        const grant = getCalculatedGrant(params)

        // Validate task config
        const errTitle = 'Incorrect vesting schema'
        const errMessage = `has not enough tokens to pay all periods`
        if (grant.assign.slice(-1)[0].grant === 0) {
          throw new GoshError(errTitle, `Assigner ${errMessage}`)
        }
        if (grant.review.slice(-1)[0].grant === 0) {
          throw new GoshError(errTitle, `Reviewer ${errMessage}`)
        }
        if (grant.manager.slice(-1)[0].grant === 0) {
          throw new GoshError(errTitle, `Manager ${errMessage}`)
        }

        // Check if task already exists
        const account = await getSystemContract().getTask({
          data: {
            daoname: dao.name,
            reponame: params.reponame,
            taskname: params.taskname,
          },
        })
        if (await account.isDeployed()) {
          throw new GoshError('Create task error', {
            message: 'Task with provided name already exists',
            name: params.taskname,
          })
        }

        // Prepare balance for create event
        await beforeCreateEvent(20, { onPendingCallback: setStatus })

        // Create task create event
        // Skip `member.wallet` check, because `beforeCreate` checks it
        setStatus((state) => ({
          ...state,
          type: 'pending',
          data: 'Creating task',
        }))
        await member.wallet!.createTask({
          reponame: params.reponame,
          taskname: params.taskname,
          config: grant,
          tags: params.tags,
          comment: params.comment,
        })

        setStatus((state) => ({
          ...state,
          type: 'success',
          data: {
            title: 'Create task',
            content: 'Create task event created',
          },
        }))
      } catch (e: any) {
        setStatus((state) => ({ ...state, type: 'error', data: e }))
        throw e
      }
    },
    [dao.name, member.isMember, member.isReady],
  )

  return {
    status,
    createTask,
    getTokenAmount,
  }
}

export function useDeleteTask() {
  const member = useDaoMember()
  const { beforeCreateEvent } = useDaoHelpers()
  const [status, setStatus] = useRecoilState(appToastStatusSelector('__deletetask'))

  const deleteTask = useCallback(
    async (params: { reponame: string; taskname: string; comment?: string }) => {
      const { reponame, taskname, comment } = params

      try {
        // Prepare balance for create event
        await beforeCreateEvent(20, { onPendingCallback: setStatus })

        // Create task delete event
        // Skip `member.wallet` check, because `beforeCreate` checks it
        setStatus((state) => ({
          ...state,
          type: 'pending',
          data: 'Deleting task',
        }))
        await member.wallet!.deleteTask({ reponame, taskname, comment })

        setStatus((state) => ({
          ...state,
          type: 'success',
          data: {
            title: 'Delete task',
            content: 'Delete task event created',
          },
        }))
      } catch (e: any) {
        setStatus((state) => ({ ...state, type: 'error', data: e }))
        throw e
      }
    },
    [member.isMember, member.isReady],
  )

  return { deleteTask, status }
}

export function useReceiveTaskReward() {
  const member = useDaoMember()

  const receiveReward = useCallback(
    async (params: { reponame: string; taskname: string }) => {
      const { reponame, taskname } = params

      if (!member.isReady || !member.wallet) {
        throw new GoshError('Access error', 'Wallet does not exist or not activated')
      }

      const types = [ETaskReward.ASSING, ETaskReward.MANAGER, ETaskReward.REVIEW]
      await Promise.all(
        types.map(async (type) => {
          await member.wallet!.receiveTaskReward({ reponame, taskname, type })
        }),
      )
    },
    [member.isReady],
  )

  return { receiveReward }
}

export function useTask(
  address: string,
  options: { initialize?: boolean; subscribe?: boolean } = {},
) {
  const { initialize, subscribe } = options
  const { details: dao } = useDao()
  const [tasks, setTasks] = useRecoilState(daoTaskListSelector(dao.name))
  const task = useRecoilValue(daoTaskSelector(address))
  const [error, setError] = useState<any>()

  const checkExists = async (account: Task) => {
    if (!(await account.isDeployed())) {
      // Close if opened
      setTasks((state) => ({
        ...state,
        items: state.items.map((item) => {
          if (item.address === account.address) {
            return { ...item, isOpen: false, isDeleted: true }
          }
          return item
        }),
      }))

      // Remove from list after short delay to allow state read
      await sleep(300)
      setTasks((state) => ({
        ...state,
        items: state.items.filter((item) => {
          return item.address !== account.address
        }),
      }))
      return false
    }
    return true
  }

  const getTaskData = async (account: Task) => {
    try {
      if (!(await checkExists(account))) {
        return
      }

      const verbose = await account.getDetails()
      setTasks((state) => ({
        ...state,
        items: state.items.map((item) => {
          if (item.address === account.address) {
            return { ...item, ...verbose }
          }
          return item
        }),
      }))
    } catch (e: any) {
      setError(e)
    }
  }

  const getTask = useCallback(async () => {
    if (!address) {
      return
    }

    try {
      // Search for task in task list state atom
      let found = tasks.items.find((item) => item.address === address)

      // Fetch task details from blockchain
      if (!found) {
        const account = await getSystemContract().getTask({ address })
        const details = await account.getDetails()
        found = { account, address, ...details }
        setTasks((state) => ({
          ...state,
          items: [...state.items, { ...found! }],
        }))
      }
    } catch (e: any) {
      setError(e)
    }
  }, [address])

  useEffect(() => {
    if (initialize) {
      getTask()
    }
  }, [getTask, initialize])

  useEffect(() => {
    const _subscribe = async () => {
      if (!task?.address || !task.account) {
        return
      }

      await task.account.account.subscribeMessages('body', async ({ body }) => {
        const decoded = await task.account!.decodeMessageBody(body, 0)
        const triggers = ['destroy', 'isReady', 'getGrant']
        if (decoded && triggers.indexOf(decoded.name) >= 0) {
          await getTaskData(task.account!)
        }
      })
    }

    const _checkExists = () => {
      if (!task?.address || !task.account) {
        return
      }

      const interval = setLockableInterval(async () => {
        if (!(await checkExists(task.account!))) {
          clearInterval(interval)
        }
      }, 10000)
      return interval
    }

    let interval: any
    if (subscribe) {
      _subscribe()
      interval = _checkExists()
    }

    return () => {
      if (subscribe) {
        task?.account?.account.free()
        clearInterval(interval)
      }
    }
  }, [task?.address, subscribe])

  return { task, error }
}
