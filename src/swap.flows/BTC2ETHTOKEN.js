import crypto from 'bitcoinjs-lib/src/crypto'
import SwapApp, { constants } from 'swap.app'
import { Flow } from 'swap.swap'


export default (tokenName) => {

  class BTC2ETHTOKEN extends Flow {

    static getName() {
      return `${constants.COINS.btc}2${tokenName.toUpperCase()}`
    }

    constructor(swap) {
      super(swap)

      this._flowName = BTC2ETHTOKEN.getName()

      this.ethTokenSwap = SwapApp.swaps[tokenName.toUpperCase()]
      this.btcSwap      = SwapApp.swaps[constants.COINS.btc]

      if (!this.ethTokenSwap) {
        throw new Error('BTC2ETH: "ethTokenSwap" of type object required')
      }
      if (!this.btcSwap) {
        throw new Error('BTC2ETH: "btcSwap" of type object required')
      }

      this.state = {
        step: 0,

        signTransactionHash: null,
        isSignFetching: false,
        isParticipantSigned: false,

        btcScriptCreatingTransactionHash: null,
        ethSwapCreationTransactionHash: null,

        secretHash: null,
        btcScriptValues: null,

        btcScriptVerified: false,

        isBalanceFetching: false,
        isBalanceEnough: false,
        balance: null,

        isEthContractFunded: false,

        ethSwapWithdrawTransactionHash: null,
        isEthWithdrawn: false,
      }

      super._persistSteps()
      this._persistState()
    }

    _persistState() {
      super._persistState()
    }

    _getSteps() {
      const flow = this

      return [

        // 1. Signs

        () => {
          flow.finishStep({
            isParticipantSigned: true,
          })
        },

        // 2. Create secret, secret hash

        () => {
          // this.submitSecret()
        },

        // 3. Check balance

        () => {
          this.syncBalance()
        },

        // 4. Create BTC Script, fund, notify participant

        async () => {
          const { sellAmount, participant } = flow.swap
          let btcScriptCreatingTransactionHash

          // TODO move this somewhere!
          const utcNow = () => Math.floor(Date.now() / 1000)
          const getLockTime = () => utcNow() + 3600 * 3 // 3 hours from now

          const scriptValues = {
            secretHash:         flow.state.secretHash,
            ownerPublicKey:     SwapApp.services.auth.accounts.btc.getPublicKey(),
            recipientPublicKey: participant.btc.publicKey,
            lockTime:           getLockTime(),
          }

          console.log('sellAmount', sellAmount)

          await flow.btcSwap.fundScript({
            scriptValues,
            amount: sellAmount,
          }, (hash) => {
            btcScriptCreatingTransactionHash = hash

            flow.setState({
              btcScriptCreatingTransactionHash: hash,
            })
          })

          flow.swap.room.sendMessage('create btc script', {
            scriptValues,
            btcScriptCreatingTransactionHash,
          })

          flow.finishStep({
            isBtcScriptFunded: true,
            btcScriptValues: scriptValues,
          })
        },

        // 5. Wait participant creates ETH Contract

        () => {
          const { participant } = flow.swap
          let timer

          flow.swap.room.once('create eth contract', ({ ethSwapCreationTransactionHash }) => {
            flow.setState({
              ethSwapCreationTransactionHash,
            })
          })

          const checkEthBalance = () => {
            timer = setTimeout(async () => {
              const balance = await flow.ethTokenSwap.getBalance({
                ownerAddress: participant.eth.address,
              })

              if (balance > 0) {
                if (!flow.state.isEthContractFunded) { // redundant condition but who cares :D
                  flow.finishStep({
                    isEthContractFunded: true,
                  })
                }
              }
              else {
                checkEthBalance()
              }
            }, 20 * 1000)
          }

          checkEthBalance()

          flow.swap.room.once('create eth contract', () => {
            if (!flow.state.isEthContractFunded) {
              clearTimeout(timer)
              timer = null

              flow.finishStep({
                isEthContractFunded: true,
              })
            }
          })
        },

        // 6. Withdraw

        async () => {
          const { buyAmount, participant } = flow.swap

          const data = {
            ownerAddress:   participant.eth.address,
            secret:         flow.state.secret,
          }

          const balanceCheckResult = await flow.ethTokenSwap.checkBalance({
            ownerAddress: participant.eth.address,
            expectedValue: buyAmount,
          })

          if (balanceCheckResult) {
            console.error(`Eth balance check error:`, balanceCheckResult)
            flow.swap.events.dispatch('eth balance check error', balanceCheckResult)
            return
          }

          await flow.ethTokenSwap.withdraw(data, (hash) => {
            flow.setState({
              ethSwapWithdrawTransactionHash: hash,
            })
          })

          flow.swap.room.sendMessage('finish eth withdraw')

          flow.finishStep({
            isEthWithdrawn: true,
          })
        },

        // 7. Finish

        () => {

        },
      ]
    }

    submitSecret(secret) {
      if (this.state.secretHash) return

      const secretHash = crypto.ripemd160(Buffer.from(secret, 'hex')).toString('hex')

      this.finishStep({
        secret,
        secretHash,
      })
    }

    async syncBalance() {
      const { sellAmount } = this.swap

      this.setState({
        isBalanceFetching: true,
      })

      const balance = await this.btcSwap.fetchBalance(SwapApp.services.auth.accounts.btc.getAddress())
      const isEnoughMoney = sellAmount.isLessThanOrEqualTo(balance)

      if (isEnoughMoney) {
        this.finishStep({
          balance,
          isBalanceFetching: false,
          isBalanceEnough: true,
        })
      }
      else {
        this.setState({
          balance,
          isBalanceFetching: false,
          isBalanceEnough: false,
        })
      }
    }

    tryRefund() {
      return this.btcSwap.refund({
        scriptValues: this.state.btcScriptValues,
        secret: this.state.secret,
      }, (hash) => {
        this.setState({
          refundTransactionHash: hash,
        })
      })
      .then(() => {
        this.setState({
          isRefunded: true,
        })
      })
    }
  }

  return BTC2ETHTOKEN
}
