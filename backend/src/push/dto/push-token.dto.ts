import { Matches, MaxLength } from 'class-validator';

// POST /push/tokens y DELETE /push/tokens. Solo tokens de Expo ("ExponentPushToken[...]"): son
// los únicos que acepta la API de push de Expo, que es por donde se envían
export class PushTokenDto {
  @MaxLength(200, { message: 'token is too long' })
  @Matches(/^Expo(nent)?PushToken\[[^\]\s]+\]$/, {
    message: 'token must be an Expo push token',
  })
  token: string;
}
