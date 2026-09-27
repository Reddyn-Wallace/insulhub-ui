import type { NextRequest } from 'next/server';
import { verifiedFinanceIdentity } from '@/lib/finance/access';
import { financeError, financeJson } from '@/lib/finance/errors';
export async function GET(request:NextRequest){try{const identity=await verifiedFinanceIdentity(request);return financeJson({userId:identity.userId,ownerPinned:process.env.FINANCE_OWNER_USER_ID===identity.userId});}catch(error){return financeError(error);}}
