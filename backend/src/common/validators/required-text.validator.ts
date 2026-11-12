import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

// Un texto no vacío. Sustituye a @IsString + @IsNotEmpty para que un campo que falta
// o llega vacío dé un solo mensaje ("Este campo es obligatorio") y no dos.
// No recorta espacios: en una contraseña son caracteres válidos
@ValidatorConstraint({ name: 'isRequiredText', async: false })
class IsRequiredTextConstraint implements ValidatorConstraintInterface {
  validate(value: unknown) {
    return typeof value === 'string' && value.length > 0;
  }

  defaultMessage(args: ValidationArguments) {
    return `${args.property} is required`;
  }
}

export function IsRequiredText(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: IsRequiredTextConstraint,
    });
  };
}
