#import <os/lock.h>

#ifndef SD_LOCK_DECLARE
#define SD_LOCK_DECLARE(lock) os_unfair_lock lock
#endif

#ifndef SD_LOCK_INIT
#define SD_LOCK_INIT(lock) lock = OS_UNFAIR_LOCK_INIT
#endif

#ifndef SD_LOCK_DESTROY
#define SD_LOCK_DESTROY(lock)
#endif

#ifndef SD_LOCK
#define SD_LOCK(lock) os_unfair_lock_lock(&(lock))
#endif

#ifndef SD_UNLOCK
#define SD_UNLOCK(lock) os_unfair_lock_unlock(&(lock))
#endif
