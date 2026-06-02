import { LoadTokenPricesOutPort } from '../../application/ports/out/tokenUsageOutPort';
import { TokenPrices } from '../../domain/tokenUsage';
import tokenPrices from './tokenPrices.json';

export class TokenPriceConfigAdapter implements LoadTokenPricesOutPort {
    async loadTokenPrices(): Promise<TokenPrices> {
        return tokenPrices;
    }
}
