import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

// Exige que el campo sea distinto de otro del mismo DTO (p. ej. nueva contraseña ≠ actual).
// Si alguno de los dos está vacío no opina: de eso ya avisa @IsNotEmpty
@ValidatorConstraint({ name: 'notEqualTo', async: false })
class NotEqualToConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments) {
    const [otherProperty] = args.constraints as [string];
    const other = (args.object as Record<string, unknown>)[otherProperty];
    if (value === undefined || value === null || value === '') return true;
    if (other === undefined || other === null || other === '') return true;
    return value !== other;
  }

  defaultMessage(args: ValidationArguments) {
    return `${args.property} must be different from ${String(args.constraints[0])}`;
  }
}

export function NotEqualTo(otherProperty: string, validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      constraints: [otherProperty],
      options: validationOptions,
      validator: NotEqualToConstraint,
    });
  };
}
