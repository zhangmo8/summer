import { Context } from '../request-handler'
import { requestMappingAssembler } from '../request-mapping'
import { OmitFirstAndSecondArg } from './utility'

const getArgName = (func, argIndex: number) => {
  var args = func.toString().match(/.*?\(([^)]*)\)/)[1]
  return args.split(',').map(function (arg) {
    return arg
      .split('=')[0]
      .replace(/\/\*.*\*\//g, '')
      .trim()
  })[argIndex]
}

// const getArgType = (target: Object, propertyKey: string, parameterIndex: number) => {
//   const types = Reflect.getMetadata('design:paramtypes', target, propertyKey)
//   return types[parameterIndex]
// }

const getArgDeclareType = (target: Object, propertyKey: string, parameterIndex: number) => {
  const types = Reflect.getOwnMetadata('DeclareTypes', target, propertyKey)
  if (!types) {
    return undefined
  }
  return types[parameterIndex]
}

const generateParamDecorator =
  (paramMethod: any, ...args: any[]) =>
  (target: Object, propertyKey: string, parameterIndex: number) => {
    const declareType = getArgDeclareType(target, propertyKey, parameterIndex)
    if (!args) {
      args = []
    }
    args.splice(0, 0, getArgName(target[propertyKey], parameterIndex))
    requestMappingAssembler.addParam(paramMethod, args, declareType, parameterIndex)
  }

type DecoratorMethodType = (ctx: Context, ...args: any[]) => any

export const createParamDecorator =
  <T extends DecoratorMethodType>(paramMethod: T): ParamDecoratorType<T> =>
  //@ts-ignore
  (...dArgs: any[]) => {
    if (dArgs.length === 3 && dArgs[0].constructor?.toString().startsWith('class ')) {
      generateParamDecorator(paramMethod)(dArgs[0], dArgs[1], dArgs[2])
      return
    }
    return generateParamDecorator(paramMethod, ...dArgs)
  }

export interface ParamDecoratorType<T extends DecoratorMethodType> {
  (...name: Parameters<OmitFirstAndSecondArg<T>>): ParameterDecorator
  (target: Object, propertyKey: string, parameterIndex: number): void
}
