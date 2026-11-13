import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

// Limita la longitud en bytes UTF-8, no en caracteres: "ñ" o un emoji ocupan más de un byte.
// Hace falta para bcrypt, que ignora en silencio todo lo que pase de 72 bytes
@ValidatorConstraint({ name: 'maxBytes', async: false })
class MaxBytesConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments) {
    if (typeof value !== 'string') return true;
    const [max] = args.constraints as [number];
    return Buffer.byteLength(value, 'utf8') <= max;
  }

  defaultMessage(args: ValidationArguments) {
    return `${args.property} must be at most ${String(args.constraints[0])} bytes`;
  }
}

export function MaxBytes(max: number, validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      constraints: [max],
      options: validationOptions,
      validator: MaxBytesConstraint,
    });
  };
}
