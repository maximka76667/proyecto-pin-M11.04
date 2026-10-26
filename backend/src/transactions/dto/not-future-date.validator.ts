import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({ name: 'notFutureDate', async: false })
class NotFutureDateConstraint implements ValidatorConstraintInterface {
  validate(value: unknown) {
    if (typeof value !== 'string') return true;

    return value <= new Date().toISOString().slice(0, 10);
  }

  defaultMessage(args: ValidationArguments) {
    return `${args.property} must not be a future date`;
  }
}

export function IsNotFutureDate(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: NotFutureDateConstraint,
    });
  };
}
