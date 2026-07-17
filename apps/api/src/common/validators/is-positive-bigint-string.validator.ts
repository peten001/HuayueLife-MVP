import {
  ValidationArguments,
  ValidationOptions,
  registerDecorator,
} from 'class-validator';

const MAX_SIGNED_BIGINT = 9_223_372_036_854_775_807n;

export function IsPositiveBigIntString(options?: ValidationOptions) {
  return (target: object, propertyName: string) => {
    registerDecorator({
      name: 'isPositiveBigIntString',
      target: target.constructor,
      propertyName,
      options,
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'string' || !/^[1-9]\d{0,18}$/.test(value)) {
            return false;
          }
          try {
            return BigInt(value) <= MAX_SIGNED_BIGINT;
          } catch {
            return false;
          }
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must be a positive signed BIGINT string`;
        },
      },
    });
  };
}
