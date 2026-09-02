package com.fengyi.ordershow.admin;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class DepartmentServiceTest {
  @Test
  void generatesStableCodesFromDepartmentNames() {
    String first = DepartmentService.generateDepartmentCode("华东业务部");
    String second = DepartmentService.generateDepartmentCode("华东业务部");

    assertThat(first).isEqualTo(second);
    assertThat(first).startsWith("DEPT-").matches("[A-Z0-9][A-Z0-9_-]{1,63}");
  }

  @Test
  void keepsAnAsciiNameReadableWhileAddingAStableUniquenessSuffix() {
    String code = DepartmentService.generateDepartmentCode("East Sales");

    assertThat(code).startsWith("EAST-SALES-");
    assertThat(code).hasSize(19);
  }

  @Test
  void differentNamesProduceDifferentBaseCodes() {
    assertThat(DepartmentService.generateDepartmentCode("华东业务部"))
        .isNotEqualTo(DepartmentService.generateDepartmentCode("华南业务部"));
  }
}
