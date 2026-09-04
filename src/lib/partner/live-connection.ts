import "server-only";
import { createHash } from "node:crypto";
import type { PartnerSql } from "./db";
import { encryptLegacyCredential } from "./legacy-credentials";
import { exchangeInsulhubLogin, INSULHUB_GRAPHQL_ENDPOINT, INSULHUB_LIVE_CONTRACT } from "./legacy/insulhub-live";
import { PARTNER_SETTINGS_SERVICE_ID } from "./settings-service";

export type LegacyConnectionStatus={configured:boolean;revision:number;updatedAt:string|null;quotePrefix:string|null};

export class PartnerLiveConnectionRepository{
  constructor(private readonly sql:PartnerSql){}
  async allowAttempt(keyHash:string,limit=5):Promise<boolean>{
    if(!/^[0-9a-f]{64}$/.test(keyHash)||!Number.isInteger(limit)||limit<1||limit>20)return false;
    return (await this.sql.query<{allowed:boolean}>("SELECT public.partner_access_rate_limit($1,$2) allowed",[keyHash,limit])).rows[0]?.allowed===true;
  }
  async status(companyId:string):Promise<LegacyConnectionStatus|null>{
    const result=await this.sql.query<{partner_ops_legacy_connection_status:Record<string,unknown>|null}>("SELECT public.partner_ops_legacy_connection_status($1,$2) partner_ops_legacy_connection_status",[PARTNER_SETTINGS_SERVICE_ID,companyId]);
    const value=result.rows[0]?.partner_ops_legacy_connection_status;if(!value)return null;
    return{configured:value.configured===true,revision:Number(value.revision),updatedAt:value.updatedAt?new Date(String(value.updatedAt)).toISOString():null,quotePrefix:typeof value.quotePrefix==="string"?value.quotePrefix:null};
  }
  async connect(input:{companyId:string;revision:number;email:string;password:string},fetchImpl:typeof fetch=fetch):Promise<"CONNECTED"|"INVALID_CREDENTIALS"|"UNAVAILABLE"|"STALE"|"NOT_FOUND">{
    const login=await exchangeInsulhubLogin(input.email,input.password,fetchImpl);
    if(login.kind==="REJECTED")return"INVALID_CREDENTIALS";if(login.kind==="UNAVAILABLE")return"UNAVAILABLE";
    const encrypted=encryptLegacyCredential({accessToken:login.accessToken},{companyId:input.companyId,endpoint:INSULHUB_GRAPHQL_ENDPOINT});
    const fingerprint=createHash("sha256").update(encrypted.ciphertext).update(encrypted.nonce).digest("hex");
    const result=await this.sql.query<{partner_ops_legacy_connection_set:boolean}>(
      "SELECT public.partner_ops_legacy_connection_set($1,$2,$3,$4,$5,$6,$7,$8,$9) partner_ops_legacy_connection_set",
      [PARTNER_SETTINGS_SERVICE_ID,input.companyId,input.revision,INSULHUB_GRAPHQL_ENDPOINT,encrypted.ciphertext,encrypted.nonce,encrypted.keyVersion,fingerprint,login.quotePrefix],
    );
    return result.rows[0]?.partner_ops_legacy_connection_set?"CONNECTED":"STALE";
  }
}

export {INSULHUB_LIVE_CONTRACT};
