import SwapCore, { Events } from '../swap.core'


class SwapRoomService {

  constructor(config) {
    if (!config || typeof config !== 'object') {
      throw new Error('SwapRoomService: "config" of type object required')
    }

    this._name   = 'room'
    this.events         = new Events()
    this.config         = config
    this.peer           = null

    this._onMount()
  }

  _onMount() {
    if (!SwapCore.env.Ipfs) {
      throw new Error('SwapRoomService: Ipfs required')
    }
    if (!SwapCore.env.IpfsRoom) {
      throw new Error('SwapRoomService: IpfsRoom required')
    }

    const ipfs = new SwapCore.env.Ipfs(this.config)

    ipfs.once('error', (err) => {
      console.log('IPFS error!', err)
    })

    ipfs.once('ready', () => ipfs.id((err, info) => {
      console.info('IPFS ready!', info)

      if (err) {
        throw err
      }

      this._init({
        peer: info.id,
        ipfsConnection: ipfs,
      })
    }))
  }

  _init({ peer, ipfsConnection }) {
    this.peer = peer

    this.connection = SwapCore.env.IpfsRoom(ipfsConnection, '../swap.online', {
      pollInterval: 5000,
    })

    this.connection.on('peer joined', this.handleUserOnline)
    this.connection.on('peer left', this.handleUserOffline)
    this.connection.on('message', this.handleNewMessage)

    this.events.dispatch('ready')
  }

  handleUserOnline = (peer) => {
    if (peer !== this.peer) {
      this.events.dispatch('user online', peer)
    }
  }

  handleUserOffline = (peer) => {
    if (peer !== this.peer) {
      this.events.dispatch('user offline', peer)
    }
  }

  handleNewMessage = (message) => {
    if (message.from === this.peer) {
      return
    }

    const data = JSON.parse(message.data.toString())

    if (data && data.length) {
      data.forEach(({ event, data }) => {
        this.events.dispatch(event, { ...(data || {}), fromPeer: message.from })
      })
    }
  }

  subscribe(eventName, handler) {
    this.events.subscribe(eventName, handler)
  }

  once(eventName, handler) {
    this.events.once(eventName, handler)
  }

  sendMessage(...args) {
    if (args.length === 1) {
      const [ message ] = args

      this.connection.broadcast(JSON.stringify(message))
    }
    else {
      const [ peer, message ] = args

      this.connection.sendTo(peer, JSON.stringify(message))
    }
  }
}


export default SwapRoomService