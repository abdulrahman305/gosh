import { TonClient } from '@eversdk/core'
import { TAddress } from '../../types'
import { BaseContract } from '../base'
import { IGoshDao } from '../interfaces'

class GoshDao extends BaseContract implements IGoshDao {
    static key: string = 'goshdao'
    static version = '4.0.0'

    constructor(client: TonClient, address: TAddress) {
        super(client, GoshDao.key, address, { version: GoshDao.version })
    }
}

export { GoshDao }
