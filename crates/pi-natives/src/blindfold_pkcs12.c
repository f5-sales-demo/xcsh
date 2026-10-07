/* Enumerate every PKCS#12 private-key bag before OpenSSL selects a key pair. */
#include <limits.h>
#include <openssl/pkcs12.h>
static int count_bags(const STACK_OF(PKCS12_SAFEBAG) * bags, int depth) {
  if (!bags || depth > 16)
    return -1;
  int count = 0;
  for (int i = 0; i < sk_PKCS12_SAFEBAG_num(bags); i++) {
    const PKCS12_SAFEBAG *bag = sk_PKCS12_SAFEBAG_value(bags, i);
    int type = PKCS12_SAFEBAG_get_nid(bag);
    if (type == NID_keyBag || type == NID_pkcs8ShroudedKeyBag)
      count++;
    else if (type == NID_safeContentsBag) {
      int nested = count_bags(PKCS12_SAFEBAG_get0_safes(bag), depth + 1);
      if (nested < 0)
        return -1;
      count += nested;
    }
  }
  return count;
}
int xcsh_pkcs12_key_count(const unsigned char *bytes, size_t length,
                          const char *password, int pass_len) {
  if (length > LONG_MAX)
    return -1;
  const unsigned char *at = bytes;
  PKCS12 *p12 = d2i_PKCS12(NULL, &at, (long)length);
  if (!p12)
    return -1;
  int result = -1;
  STACK_OF(PKCS7) *safes = NULL;
  if (at != bytes + length || !PKCS12_verify_mac(p12, password, pass_len))
    goto done;
  safes = PKCS12_unpack_authsafes(p12);
  if (!safes)
    goto done;
  result = 0;
  for (int i = 0; i < sk_PKCS7_num(safes); i++) {
    PKCS7 *safe = sk_PKCS7_value(safes, i);
    STACK_OF(PKCS12_SAFEBAG) *bags = NULL;
    if (PKCS7_type_is_data(safe))
      bags = PKCS12_unpack_p7data(safe);
    else if (PKCS7_type_is_encrypted(safe))
      bags = PKCS12_unpack_p7encdata(safe, password, pass_len);
    int count = count_bags(bags, 0);
    sk_PKCS12_SAFEBAG_pop_free(bags, PKCS12_SAFEBAG_free);
    if (count < 0) {
      result = -1;
      break;
    }
    result += count;
  }
done:
  sk_PKCS7_pop_free(safes, PKCS7_free);
  PKCS12_free(p12);
  return result;
}
