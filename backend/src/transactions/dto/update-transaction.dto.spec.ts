import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateTransactionDto } from './update-transaction.dto';

// Same validation the global ValidationPipe runs on PATCH /transactions/:id
async function errorsFor(body: object) {
  const errors = await validate(plainToInstance(UpdateTransactionDto, body));
  return errors.map((error) => error.property);
}

describe('UpdateTransactionDto', () => {
  it('accepts a valid amount and category', async () => {
    expect(await errorsFor({ amount: '12.50', category: 'utilities' })).toEqual([]);
  });

  it('accepts an empty body (all fields are optional)', async () => {
    expect(await errorsFor({})).toEqual([]);
  });

  it.each(['12', '12.5', '12.50', '0.01', '999999.99'])(
    'accepts the amount %p',
    async (amount) => {
      expect(await errorsFor({ amount })).toEqual([]);
    },
  );

  it.each([
    ['not a number', 'abc'],
    ['empty', ''],
    ['negative', '-5'],
    ['zero', '0'],
    ['zero with decimals', '0.00'],
    ['more than 2 decimals', '12.999'],
    ['comma as decimal separator', '12,50'],
    ['more than 6 integer digits', '1000000'],
    ['too big for the database', '12345678901'],
    ['scientific notation', '1e3'],
    ['surrounded by spaces', ' 12 '],
  ])('rejects an amount that is %s (%p)', async (_, amount) => {
    expect(await errorsFor({ amount })).toEqual(['amount']);
  });

  it('rejects an amount sent as a number instead of text', async () => {
    expect(await errorsFor({ amount: 12.5 })).toEqual(['amount']);
  });

  it('rejects an unknown category', async () => {
    expect(await errorsFor({ category: 'food' })).toEqual(['category']);
  });

  it.each(['apartment_id', 'from_user_id', 'to_user_id'])(
    'rejects a %s that is not a uuid',
    async (field) => {
      expect(await errorsFor({ [field]: 'not-a-uuid' })).toEqual([field]);
    },
  );
});
