import { locContainer } from './../loc'
import { Logger } from './../logger'
import { getConfig } from './../config-handler'

import { rpc } from '../rpc'

interface RpcProviderDecoratorType {
  (): ClassDecorator
  (target: any): void
}

export const RpcProvider: RpcProviderDecoratorType = (...args) => {
  if (args.length === 0) {
    return (target: any) => {
      rpc.addRpcClass(target)
    }
  } else {
    rpc.addRpcClass(args[0])
  }
}

export const RpcClient = (source: string, targetClass?: string) => {
  return (target: any) => {
    locContainer.paddingLocClass(target)
    Object.getOwnPropertyNames(target.prototype).forEach((method) => {
      if (typeof target.prototype[method] === 'function' && method !== 'constructor') {
        target.prototype[method] = async (...args) => {
          const config = getConfig()['RPC_CONFIG']
          if (!config) {
            Logger.error('RPC_CONFIG is missing in config')
            return
          }
          const [type, declareType] = Reflect.getMetadata('ReturnDeclareType', target.prototype, method)
          if (config.client[source]) {
            const result = await rpc.rpcRequest(
              config.client[source],
              {
                class: targetClass || target.name,
                method: method,
                data: args
              },
              type,
              declareType,
              this
            )
            return result
          } else {
            Logger.error(source + ' not found in RPC_CONFIG.client')
          }
        }
      }
    })
  }
}
