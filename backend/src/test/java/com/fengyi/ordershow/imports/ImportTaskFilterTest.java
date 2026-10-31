package com.fengyi.ordershow.imports;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.fengyi.ordershow.common.DomainException;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

class ImportTaskFilterTest {
  private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
  private final ImportService service = new ImportService(jdbc, null, null, null, null, null, null, null,
      mock(ImportTaskRepository.class));

  @Test void openedModuleFiltersTasksInTheDatabase() {
    service.tasks(7L, "PRODUCT");
    verify(jdbc).query(contains("AND t.import_type=?"), any(RowMapper.class), eq(7L), eq("PRODUCT"));
    verifyNoMoreInteractions(jdbc);
  }

  @Test void existingCallersCanStillListAllActivityTasks() {
    service.tasks(7L);
    verify(jdbc).query(argThat((String sql) -> !sql.contains("t.import_type=?")), any(RowMapper.class), eq(7L));
  }

  @Test void rejectsInvalidTypesBeforeAnyDatabaseRead() {
    assertThatThrownBy(() -> service.tasks(7L, "INVALID")).isInstanceOf(DomainException.class);
    verifyNoInteractions(jdbc);
  }
}
