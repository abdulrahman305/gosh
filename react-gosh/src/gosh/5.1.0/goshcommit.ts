import { TonClient } from '@eversdk/core'
import { TAddress } from '../../types'
import { BaseContract } from '../base'
import { IGoshCommit } from '../interfaces'

class GoshCommit extends BaseContract implements IGoshCommit {
    static key: string = 'commit'
    static version = '5.1.0'

    constructor(client: TonClient, address: TAddress) {
        super(client, GoshCommit.key, address, { version: GoshCommit.version })
    }
}

export { GoshCommit }
