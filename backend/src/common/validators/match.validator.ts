import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

// Exige que el campo sea idéntico a otro del mismo DTO (p. ej. confirmar la contraseña).
// Si el campo está vacío no opina: de eso ya avisa @IsRequiredText con su propio mensaje
@ValidatorConstraint({ name: 'match', async: false })
class MatchConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments) {
    if (value === undefined || value === null || value === '') return true;
    const [otherProperty] = args.constraints as [string];
    return value === (args.object as Record<string, unknown>)[otherProperty];
  }

  defaultMessage(args: ValidationArguments) {
    return `${args.property} must match ${String(args.constraints[0])}`;
  }
}

export function Match(otherProperty: string, validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      constraints: [otherProperty],
      options: validationOptions,
      validator: MatchConstraint,
    });
  };
}
