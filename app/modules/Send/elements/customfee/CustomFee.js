/**
 * @version 0.9
 */
import React, { Component } from 'react'

import { View, Text } from 'react-native'

import CustomFeeBitcoin from './CustomFeeBitcoin'

import CustomFeeEthereum from './CustomFeeEthereum'


class CustomFee extends Component {

    constructor(props) {
        super(props)
        this.state = {
            selectedCustomFeeComponent: ''
        }

        this.customFeeBitcoin = React.createRef()
        this.customFeeEthereum = React.createRef()

    }

    handleGetCustomFee = async () => {

        const fee = await this[`${this.state.selectedCustomFeeComponent}`].getCustomFee()

        if (typeof fee == 'undefined')
            throw new Error('validate error')

        return fee
    }

    callTransferAll = (fee) => {

        const { useAllFunds, handleTransferAll } = this.props

        if (useAllFunds) {
            handleTransferAll(fee)
        }
    }

    renderFee = () => {

        const { currencyCode, getCustomFee, useAllFunds } = this.props

        switch (currencyCode) {
            // @misha could it be unified on "ETH" + tokens and "BTC" + btclike
            case 'ETH':
            case 'ETH_ROPSTEN':
            case 'ETH_TRUE_USD':
            case 'ETH_USDT':
            case 'ETH_BNB':
            case 'ETH_USDC':
            case 'ETH_PAX':
            case 'ETH_DAI':
            case 'ETH_ROPSTEN_KSU_TOKEN':
                this.state.selectedCustomFeeComponent = 'customFeeEthereum'
                return <CustomFeeEthereum
                    ref={ref => this.customFeeEthereum = ref}
                    getCustomFee={getCustomFee}
                    fee={this.props.fee}
                    currencyCode={currencyCode}
                    callTransferAll={this.callTransferAll}
                    useAllFunds={useAllFunds}/>
            case 'BTC':
            case 'DOGE':
            case 'BTC_TEST':
            case 'USDT':
                this.state.selectedCustomFeeComponent = 'customFeeBitcoin'
                return <CustomFeeBitcoin
                    ref={ref => this.customFeeBitcoin = ref}
                    getCustomFee={getCustomFee}
                    fee={this.props.fee}
                    currencyCode={currencyCode}
                    callTransferAll={this.callTransferAll}
                    useAllFunds={useAllFunds}/>
            default:

                return <View><Text>Default</Text></View>
        }
    }

    render() {
        return this.renderFee()
    }
}

export default CustomFee
