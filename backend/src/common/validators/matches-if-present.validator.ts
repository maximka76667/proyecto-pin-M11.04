import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

// Como @Matches, pero un campo vacío o ausente pasa: así ese caso solo muestra
// el mensaje de @IsRequiredText y no también el del formato
@ValidatorConstraint({ name: 'matchesIfPresent', async: false })
class MatchesIfPresentConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments) {
    if (value === undefined || value === null || value === '') return true;
    if (typeof value !== 'string') return false;
    const [pattern] = args.constraints as [RegExp];
    return pattern.test(value);
  }

  defaultMessage(args: ValidationArguments) {
    return `${args.property} has an invalid format`;
  }
}

export function MatchesIfPresent(pattern: RegExp, validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      constraints: [pattern],
      options: validationOptions,
      validator: MatchesIfPresentConstraint,
    });
  };
}
