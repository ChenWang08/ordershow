package com.fengyi.ordershow.storage;

import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import org.springframework.stereotype.Service;

/** Persist derivatives once; bounded memory and same-image single flight also cover old uploads. */
@Service
public class ImageVariantService {
  private final StorageService storage;
  private final Map<Key, ImageVariants.Encoded> cache = new LinkedHashMap<>(32, .75f, true);
  private final Map<Key, CompletableFuture<ImageVariants.Encoded>> flights = new HashMap<>();
  private long cachedBytes;
  public ImageVariantService(StorageService storage) { this.storage = storage; }
  private record Key(long id, ImageVariants.Kind kind) {}

  public ImageVariants.Encoded read(StorageService.FileMeta meta, ImageVariants.Kind kind) {
    var key = new Key(meta.id(), kind);
    CompletableFuture<ImageVariants.Encoded> flight;
    boolean owner = false;
    synchronized (cache) {
      var cached = cache.get(key);
      if (cached != null) return cached;
      flight = flights.get(key);
      if (flight == null) {
        if (flights.size() >= 8) throw ImageVariants.busy();
        flights.put(key, flight = new CompletableFuture<>());
        owner = true;
      }
    }
    if (owner) {
      try {
        var result = storage.readVariant(meta, kind);
        if (result == null) {
          result = ImageVariants.render(storage.read(meta), kind);
          storage.writeVariant(meta, kind, result);
        }
        synchronized (cache) {
          while (!cache.isEmpty() && (cache.size() >= 128 || cachedBytes + result.bytes().length > 16 * 1024 * 1024L)) {
            var iterator = cache.entrySet().iterator();
            cachedBytes -= iterator.next().getValue().bytes().length; iterator.remove();
          }
          cache.put(key, result); cachedBytes += result.bytes().length;
        }
        flight.complete(result);
      } catch (Exception error) { flight.completeExceptionally(error); }
      finally { synchronized (cache) { flights.remove(key); } }
    }
    try { return flight.get(15, TimeUnit.SECONDS); }
    catch (ExecutionException error) {
      if (error.getCause() instanceof RuntimeException cause) throw cause;
      throw ImageVariants.busy();
    } catch (InterruptedException error) { Thread.currentThread().interrupt(); throw ImageVariants.busy(); }
    catch (java.util.concurrent.TimeoutException error) { throw ImageVariants.busy(); }
  }
}
