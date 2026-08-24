package com.fengyi.ordershow.storage;

import org.springframework.http.CacheControl;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/public/files")
public class FileController {
  private final StorageService storage;

  public FileController(StorageService storage) { this.storage = storage; }

  @GetMapping("/{fileId}")
  ResponseEntity<byte[]> get(@PathVariable long fileId) {
    StorageService.FileMeta meta = storage.meta(fileId);
    MediaType contentType;
    try { contentType = MediaType.parseMediaType(meta.contentType()); }
    catch (Exception ignored) { contentType = MediaType.APPLICATION_OCTET_STREAM; }
    return ResponseEntity.ok().contentType(contentType).contentLength(meta.sizeBytes())
        .cacheControl(CacheControl.noCache())
        .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.inline().filename(meta.filename()).build().toString())
        .body(storage.read(fileId));
  }
}
