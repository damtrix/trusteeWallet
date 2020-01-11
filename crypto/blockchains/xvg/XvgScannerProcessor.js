/**
 * @version 0.5
 * https://github.com/bitpay/bitcore/blob/master/packages/bitcore-node/docs/api-documentation.md
 * https://api.vergecurrency.network/node/api/XVG/mainnet/address/DL5LtSf7wztH45VuYunL8oaQHtJbKLCHyw/balance
 */
import BlocksoftAxios from '../../common/BlocksoftAxios'
import BlocksoftCryptoLog from '../../common/BlocksoftCryptoLog'
import XvgTmpDS from './stores/XvgTmpDS'

const API_PATH = 'https://api.vergecurrency.network/node/api/XVG/mainnet'
const CACHE_VALID_TIME = 30000 // 30 seconds
const CACHE = {}
let CACHE_FROM_DB = {}

export default class XvgScannerProcessor {
    /**
     * @type {number}
     * @private
     */
    _blocksToConfirm = 20

    /**
     * @param {string} address
     * @return {Promise<{balance:*, unconfirmed:*, provider:string}>}
     */
    async getBalance(address) {
        let link = `${API_PATH}/address/${address}/balance`
        let res = await BlocksoftAxios.getWithoutBraking(link)
        if (!res || !res.data || typeof res.data.confirmed === 'undefined') {
            return false
        }
        let balance = res.data.confirmed
        return { balance, unconfirmed: 0, provider: 'api.vergecurrency' }
    }

    /**
     * @param {string} address
     * @return {Promise<UnifiedTransaction[]>}
     */
    async getTransactions(address) {
        address = address.trim()
        BlocksoftCryptoLog.log('XvgScannerProcessor.getTransactions started', address)
        let link = `${API_PATH}/address/${address}/txs`
        BlocksoftCryptoLog.log('XvgScannerProcessor.getTransactions call ' + link)
        let tmp = await BlocksoftAxios.get(link)
        if (tmp.status < 200 || tmp.status >= 300) {
            throw new Error('not valid server response status ' + link)
        }

        if (typeof tmp.data === 'undefined' || !tmp.data) {
            throw new Error('Undefined txs ' + link + ' ' + JSON.stringify(tmp.data))
        }

        tmp = tmp.data
        if (tmp.data) {
            tmp = tmp.data // wtf but ok to support old wallets
        }

        let transactions = []
        let already = {}
        CACHE_FROM_DB = await XvgTmpDS.getCache(address)

        for (let tx of tmp) { //ASC order is important
            let tmp2 = await this._unifyTransactionStep1(address, tx, already)
            if (tmp2) {
                if (tmp2.outcoming) {
                    if (typeof CACHE_FROM_DB[tmp2.outcoming.transaction_hash + '_data'] === 'undefined') {
                        tmp2.outcoming = await this._unifyTransactionStep2(address, tmp2.outcoming)
                        if (tmp2.outcoming) {
                            already[tmp2.outcoming.transaction_hash] = 1
                            if (tmp2.outcoming.address_to === '?') {
                                tmp2.outcoming.address_to = 'self'
                                BlocksoftCryptoLog.log('XvgScannerProcessor.getTransactions consider as self ' + tmp2.outcoming.transaction_hash)
                            }
                            transactions.push(tmp2.outcoming)
                        }
                    } else {
                        already[tmp2.outcoming.transaction_hash] = 1
                    }
                }
                if (tmp2.incoming) {
                    if (typeof CACHE_FROM_DB[tmp2.incoming.transaction_hash + '_data'] === 'undefined') {
                        tmp2.incoming = await this._unifyTransactionStep2(address, tmp2.incoming)
                        if (tmp2.incoming) {
                            already[tmp2.incoming.transaction_hash] = 1
                            transactions.push(tmp2.incoming)
                        }
                    } else {
                        already[tmp2.incoming.transaction_hash] = 1
                    }
                }
            }
        }
        BlocksoftCryptoLog.log('XvgScannerProcessor.getTransactions finished', address)
        BlocksoftCryptoLog.log('XvgScannerProcessor.getTransactions new tx total', transactions.length)
        return transactions

    }

    /**
     * https://api.vergecurrency.network/node/api/XVG/mainnet/tx/abcda88bdb3968c5e444694ce3914cdec34f3afab73627bf201d34493d5e3aae/coins
     * @param address
     * @param transaction
     * @returns {Promise<boolean|*>}
     * @private
     */
    async _unifyTransactionStep2(address, transaction) {
        if (!transaction) return false

        if (typeof CACHE[transaction.transaction_hash] !== 'undefined') {
            if (CACHE[transaction.transaction_hash]['data'].block_confirmations > 100) {
                return CACHE[transaction.transaction_hash]['data']
            }
            let now = new Date().getTime()
            if (now - CACHE[transaction.transaction_hash]['time'] < CACHE_VALID_TIME) {
                return CACHE[transaction.transaction_hash]['data']
            }
        }

        let tmp
        if (typeof CACHE_FROM_DB[transaction.transaction_hash + '_coins'] !== 'undefined') {
            tmp = CACHE_FROM_DB[transaction.transaction_hash + '_coins']
        } else {
            let link = `${API_PATH}/tx/${transaction.transaction_hash}/coins`
            BlocksoftCryptoLog.log('XvgScannerProcessor._unifyTransactionStep2 call for outputs ' + link)
            tmp = await BlocksoftAxios.get(link)
            tmp = tmp.data
            XvgTmpDS.saveCache(address, transaction.transaction_hash, 'coins', tmp)
            CACHE_FROM_DB[transaction.transaction_hash + '_coins'] = tmp
        }
        if (transaction.transaction_direction === 'income') {
            let self = false
            for (let input of tmp.inputs) {
                if (input.address) {
                    if (input.address !== address) {
                        transaction.address_from = input.address
                        break
                    } else {
                        self = true
                    }
                }
            }
            if (transaction.address_from === '?' && self) {
                transaction.address_from = address
            }
        } else {
            for (let input of tmp.inputs) {
                if (input.address && input.address === address) {
                    transaction.address_amount = input.value
                    break
                }
            }
            for (let output of tmp.outputs) {
                if (output.address) {
                    if (output.address !== address) {
                        transaction.address_to = output.address
                    }
                }
            }
        }
        if (transaction.address_from === address) {
            transaction.transaction_direction = 'outcome'
        }
        if (transaction.address_to === address) {
            transaction.transaction_direction = 'income'
        }

        let link2 = `${API_PATH}/tx/${transaction.transaction_hash}`
        BlocksoftCryptoLog.log('XvgScannerProcessor._unifyTransactionStep2 call for details ' + link2)
        let tmp2 = await BlocksoftAxios.get(link2)
        tmp2 = tmp2.data
        BlocksoftCryptoLog.log('XvgScannerProcessor._unifyTransactionStep2 call for details result ', tmp2)
        transaction.block_hash = tmp2.blockHash
        transaction.block_time = tmp2.blockTimeNormalized
        transaction.block_confirmations = tmp2.confirmations * 1
        if (transaction.block_confirmations < 0) transaction.block_confirmations = transaction.block_confirmations * -1

        transaction.transaction_fee = tmp2.fee
        transaction.transaction_status = transaction.block_confirmations > this._blocksToConfirm ? 'success' : 'new'
        if (transaction.transaction_status === 'success') {
            XvgTmpDS.saveCache(address, transaction.transaction_hash, 'data', tmp2)
            CACHE_FROM_DB[transaction.transaction_hash + '_data'] = 1 //no need all - just mark
        }
        CACHE[transaction.transaction_hash] = {}
        CACHE[transaction.transaction_hash]['time'] = new Date().getTime()
        CACHE[transaction.transaction_hash]['data'] = transaction
        return transaction
    }

    /**
     *
     * @param {string} address
     * @param {Object} transaction
     * @param {string} transaction._id 5dcedb83746f4c73710ff5ce
     * @param {string} transaction.chain XVG
     * @param {string} transaction.network mainnet
     * @param {string} transaction.coinbase false
     * @param {string} transaction.mintIndex 0
     * @param {string} transaction.spentTxid
     * @param {string} transaction.mintTxid abcda88bdb3968c5e444694ce3914cdec34f3afab73627bf201d34493d5e3aae
     * @param {string} transaction.mintHeight 3600363
     * @param {string} transaction.spentHeight
     * @param {string} transaction.address DL5LtSf7wztH45VuYunL8oaQHtJbKLCHyw
     * @param {string} transaction.script 76a914a3d43334ff9ea4c257a1796b63e4fa8330747d2e88ac
     * @param {string} transaction.value 95000000
     * @param {string} transaction.confirmations
     * @return {UnifiedTransaction}
     * @private
     */
    async _unifyTransactionStep1(address, transaction, already) {
        if (transaction.chain !== 'XVG' || transaction.network !== 'mainnet') return false
        let res = { incoming: false, outcoming: false }
        if (transaction.spentTxid && typeof already[transaction.spentTxid] === 'undefined') {
            res.outcoming = {
                transaction_hash: transaction.spentTxid,
                block_hash: '?',
                block_number: +transaction.spentHeight,
                block_time: '?',
                block_confirmations: '?',
                transaction_direction: 'outcome',
                address_from: transaction.address,
                address_to: '?',
                address_amount: '?',
                transaction_status: '?'
            }
        }
        if (transaction.mintTxid && transaction.mintTxid !== transaction.spentTxid && typeof already[transaction.mintTxid] === 'undefined') {
            res.incoming = {
                transaction_hash: transaction.mintTxid,
                block_hash: '?',
                block_number: +transaction.mintHeight,
                block_time: '?',
                block_confirmations: '?',
                transaction_direction: 'income',
                address_from: '?',
                address_to: transaction.address,
                address_amount: transaction.value,
                transaction_status: '?'
            }
        }
        return res

    }
}