import { Logger } from '../logger'
import { errorHandle } from '../error'
import { iocContainer } from '../ioc'

interface ErrorHandlerType {
  (): ClassDecorator
  (target: Object): void
}

// @ts-ignore
export const ErrorHandler: ErrorHandlerType = (...args) => {
  const instanceHandler = (target) => {
    if (!errorHandle.errorHandlerClass) {
      errorHandle.errorHandlerClass = target
      iocContainer.pendingIocClass(target)
    } else {
      Logger.error('Duplicate ErrorHandler')
      process.exit()
    }
  }

  if (args.length == 0) {
    return (target: any) => {
      instanceHandler(target)
    }
  } else {
    instanceHandler(args[0])
  }
}

export const E = (err: any): MethodDecorator => {
  return (_target: any, method: string) => {
    errorHandle.errorMap.push({ type: err, method: method })
  }
}
